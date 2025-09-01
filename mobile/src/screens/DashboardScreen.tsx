import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, ScrollView, Text, TextInput, View, RefreshControl } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../App';
import { useGoogleAuth } from '../hooks/useGoogleAuth';
// Switch Dashboard data source to Google Sheets registry
import { findOrCreateSpreadsheet, listAllReceipts, updateReimbursedCell, type ReceiptRow } from '../google/sheets';

type Props = NativeStackScreenProps<RootStackParamList, 'Dashboard'>;

type ReceiptMeta = {
  provider?: string;
  patientName?: string;
  amountCents?: number;
  currency?: string;
  date?: string; // legacy; prefer startDate/endDate
  startDate?: string;
  endDate?: string;
  reimbursed?: boolean;
};

export default function DashboardScreen({ navigation }: Props) {
  const { accessToken, signIn } = useGoogleAuth();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Array<{ id: string; row: ReceiptRow; meta: ReceiptMeta }>>([]);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [authRequired, setAuthRequired] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'reimbursed' | 'unreimbursed'>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ReceiptMeta>>({});
  const [pageIndex, setPageIndex] = useState<number>(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, signIn]);

  async function reload() {
    setLoading(true);
    setAuthRequired(false);
    setErrorMsg(null);
    try {
      let token = accessToken!;
      const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
        try {
          return await fn(token);
        } catch (e: any) {
          const msg = String(e?.message || e || '');
          if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
            const t2 = await signIn();
            if (!t2) {
              setAuthRequired(true);
              throw new Error('AUTH_REQUIRED');
            }
            token = t2;
            return await fn(token);
          }
          throw e;
        }
      };

      const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
      const all = await withAuthRetry((t) => listAllReceipts(t, spreadsheetId));
      // Build items from bottom (newest at end since we append); slice last 20
      const sliced = all.slice(-20).reverse();
      const results: Array<{ id: string; row: ReceiptRow; meta: ReceiptMeta }>= sliced.map((r) => ({ id: String(r.rowNumber), row: r, meta: {
        provider: r.provider,
        patientName: r.patientName,
        amountCents: r.amountCents,
        currency: r.currency,
        date: r.startDate,
        startDate: r.startDate,
        endDate: r.endDate,
        reimbursed: !!r.reimbursed,
      }}));
      setItems(results);
      setPageIndex(20);
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      if (msg !== 'AUTH_REQUIRED') setErrorMsg(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const s = startDate ? new Date(startDate) : null;
    const e = endDate ? new Date(endDate) : null;
    let arr = items.filter((it) => {
      const svc = it.meta.startDate || it.meta.date;
      if (!svc) return true;
      const d = new Date(svc);
      if (s && d < s) return false;
      if (e && d > e) return false;
      return true;
    });
    if (filterStatus !== 'all') arr = arr.filter((it) => !!it.meta.reimbursed === (filterStatus === 'reimbursed'));
    arr.sort((a, b) => {
      const da = a.meta.startDate || a.meta.date || '';
      const db = b.meta.startDate || b.meta.date || '';
      if (sortOrder === 'desc') return db < da ? -1 : 1;
      return da < db ? -1 : 1;
    });
    return arr;
  }, [items, startDate, endDate, filterStatus, sortOrder]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); reload(); }} />}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <Button title="Refresh" onPress={() => reload()} />
        <View style={{ width: 8 }} />
        <Button title={`Sort: ${sortOrder === 'desc' ? 'Newest' : 'Oldest'}`} onPress={() => setSortOrder((p) => (p === 'desc' ? 'asc' : 'desc'))} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <Text>Start Date</Text>
          <TextInput value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
        </View>
        <View style={{ width: 12 }} />
        <View style={{ flex: 1 }}>
          <Text>End Date</Text>
          <TextInput value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
        </View>
      </View>
      <View style={{ height: 12 }} />
      {loading ? <ActivityIndicator /> : null}
      {authRequired ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: '#b00', marginBottom: 8 }}>
            {stopAutoReload ? 'Too many authorization failures. Please sign in to resume.' : 'Session expired. Please sign in to refresh.'}
          </Text>
          <Button title="Sign in with Google" onPress={async () => {
            const t = await signIn();
            if (t) {
              // reset auth failure state and reload
              setAuthRequired(false);
              setLoading(true);
              setAuthFailCount(0);
              setStopAutoReload(false);
              const s = startDate; const e = endDate;
              setStartDate(s);
              setEndDate(e);
              reload();
            }
          }} />
          {stopAutoReload ? (
            <View style={{ marginTop: 8 }}>
              <Button title="Try again" onPress={() => { setAuthFailCount(0); setStopAutoReload(false); reload(); }} />
            </View>
          ) : null}
        </View>
      ) : null}
      {errorMsg ? <Text style={{ color: '#b00', marginBottom: 12 }}>{errorMsg}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Text>Status Filter:</Text>
        <Button title={`All${filterStatus === 'all' ? ' ✓' : ''}`} onPress={() => setFilterStatus('all')} />
        <Button title={`Reimbursed${filterStatus === 'reimbursed' ? ' ✓' : ''}`} onPress={() => setFilterStatus('reimbursed')} />
        <Button title={`Unreimbursed${filterStatus === 'unreimbursed' ? ' ✓' : ''}`} onPress={() => setFilterStatus('unreimbursed')} />
      </View>
      {filtered.map((it) => (
        <View key={it.id} style={{ borderWidth: 1, borderRadius: 8, padding: 12, marginBottom: 8 }}>
          {!editing[it.id] ? (
            <>
              <Text style={{ fontWeight: '600' }}>{it.meta.provider || '(Provider)'}</Text>
          <Text style={{ color: '#666' }}>
            Service: {it.meta.startDate || it.meta.date || '-'}
            {it.meta.endDate ? ` → ${it.meta.endDate}` : ''}
          </Text>
              <View style={{ height: 6 }} />
              <Text>Who: {it.meta.patientName || '-'}</Text>
              <Text>Amount: {formatAmount(it.meta.amountCents)} {it.meta.currency || ''}</Text>
              <View style={{ height: 8 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text>Reimbursed: {it.meta.reimbursed ? 'Yes' : 'No'}</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button title="Edit" onPress={() => { setEditing((e) => ({ ...e, [it.id]: true })); setDrafts((d) => ({ ...d, [it.id]: { ...it.meta } })); }} />
                  <Button
                    title={updating[it.id] ? 'Saving…' : it.meta.reimbursed ? 'Mark Unreimbursed' : 'Mark Reimbursed'}
                    disabled={!!updating[it.id]}
                    onPress={async () => {
                      if (!accessToken) return;
                      setUpdating((u) => ({ ...u, [it.id]: true }));
                      try {
                        const newMeta = { ...it.meta, reimbursed: !it.meta.reimbursed } as ReceiptMeta & Record<string, any>;
                        let token = accessToken;
                        const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                          try { return await fn(token); } catch (e: any) {
                            const msg = String(e?.message || e || '');
                            if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                              const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                            }
                            throw e;
                          }
                        };
                        const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                        await withAuthRetry((t) => updateReimbursedCell(t, spreadsheetId, it.row.rowNumber, !it.meta.reimbursed));
                        setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, meta: newMeta } : x)));
                      } catch (e: any) {
                        console.error('Update reimbursed failed', e);
                        alert(e?.message || 'Update failed');
                      } finally {
                        setUpdating((u) => ({ ...u, [it.id]: false }));
                      }
                    }}
                  />
                </View>
              </View>
            </>
          ) : (
            <>
              <Text>Provider</Text>
              <TextInput value={drafts[it.id]?.provider || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], provider: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
              <View style={{ height: 6 }} />
              <Text>Patient Name</Text>
              <TextInput value={drafts[it.id]?.patientName || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], patientName: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
              <View style={{ height: 6 }} />
              <Text>Start Date</Text>
              <TextInput value={drafts[it.id]?.startDate || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], startDate: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
              <View style={{ height: 6 }} />
              <Text>End Date</Text>
              <TextInput value={drafts[it.id]?.endDate || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], endDate: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
              <View style={{ height: 6 }} />
              <Text>Amount (e.g., 12.34)</Text>
              <TextInput
                value={draftDollarValue(drafts[it.id]?.amountCents)}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], amountCents: dollarsToCents(v) } }))}
                keyboardType="decimal-pad"
                style={{ borderWidth: 1, padding: 8, borderRadius: 6 }}
              />
              <View style={{ height: 6 }} />
              <Text>Currency</Text>
              <TextInput value={drafts[it.id]?.currency || ''} onChangeText={(v) => setDrafts((d) => ({ ...d, [it.id]: { ...d[it.id], currency: v } }))} style={{ borderWidth: 1, padding: 8, borderRadius: 6 }} />
              <View style={{ height: 8 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title={updating[it.id] ? 'Saving…' : 'Save'} disabled={!!updating[it.id]} onPress={async () => {
                  if (!accessToken) return;
                  setUpdating((u) => ({ ...u, [it.id]: true }));
                  try {
                    const draft = drafts[it.id] || {};
                    const newMeta: ReceiptMeta & Record<string, any> = {
                      ...it.meta,
                      provider: draft.provider ?? it.meta.provider,
                      patientName: draft.patientName ?? it.meta.patientName,
                      startDate: draft.startDate ?? (it.meta as any).startDate,
                      endDate: draft.endDate ?? (it.meta as any).endDate,
                      amountCents: draft.amountCents ?? it.meta.amountCents,
                      currency: draft.currency ?? it.meta.currency,
                    } as any;
                    let token = accessToken;
                    const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                      try { return await fn(token); } catch (e: any) {
                        const msg = String(e?.message || e || '');
                        if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                          const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                        }
                        throw e;
                      }
                    };
                    const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
                    const rowValues = [
                      newMeta.provider ?? '',
                      newMeta.patientName ?? '',
                      newMeta.amountCents ?? '',
                      newMeta.currency ?? '',
                      (newMeta as any).startDate ?? '',
                      (newMeta as any).endDate ?? '',
                    ];
                    const range = `Receipts!B${it.row.rowNumber}:G${it.row.rowNumber}`;
                    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
                      method: 'PUT',
                      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                      body: JSON.stringify({ values: [rowValues] }),
                    });
                    setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, meta: newMeta } : x)));
                    setEditing((e) => ({ ...e, [it.id]: false }));
                  } catch (e: any) {
                    console.error('Save edits failed', e);
                    alert(e?.message || 'Save failed');
                  } finally {
                    setUpdating((u) => ({ ...u, [it.id]: false }));
                  }
                }} />
                <Button title="Cancel" onPress={() => setEditing((e) => ({ ...e, [it.id]: false }))} />
              </View>
            </>
          )}
        </View>
      ))}
      {items.length >= pageIndex ? (
        <View style={{ marginTop: 8 }}>
          <Button title={loadingMore ? 'Loading…' : 'Show more'} disabled={loadingMore} onPress={async () => {
            if (!accessToken) return;
            setLoadingMore(true);
            try {
              let token = accessToken;
              const withAuthRetry = async <T,>(fn: (t: string) => Promise<T>): Promise<T> => {
                try { return await fn(token); } catch (e: any) {
                  const msg = String(e?.message || e || '');
                  if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('Invalid Credentials')) {
                    const t2 = await signIn(); if (!t2) throw e; token = t2; return await fn(token);
                  }
                  throw e;
                }
              };
              const spreadsheetId = await withAuthRetry((t) => findOrCreateSpreadsheet(t));
              const all = await withAuthRetry((t) => listAllReceipts(t, spreadsheetId));
              const start = all.length - (pageIndex + 20);
              const end = all.length - pageIndex;
              const slice = all.slice(Math.max(0, start), Math.max(0, end)).reverse();
              const newItems = slice.map((r) => ({ id: String(r.rowNumber), row: r, meta: {
                provider: r.provider,
                patientName: r.patientName,
                amountCents: r.amountCents,
                currency: r.currency,
                date: r.startDate,
                startDate: r.startDate,
                endDate: r.endDate,
                reimbursed: !!r.reimbursed,
              }}));
              setItems((prev) => [...prev, ...newItems]);
              setPageIndex(pageIndex + 20);
            } finally {
              setLoadingMore(false);
            }
          }} />
        </View>
      ) : null}
      <View style={{ height: 16 }} />
      {navigation && (navigation as any).navigate ? (
        <Button title="Scan Receipts" onPress={() => navigation.navigate('Scan')} />
      ) : null}
    </ScrollView>
  );
}

function formatAmount(cents?: number) {
  if (cents == null) return '-';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const minor = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${minor}`;
}

function dollarsToCents(input?: string): number | undefined {
  if (input == null) return undefined;
  const normalized = (input || '').replace(/[^0-9.]/g, '');
  if (!normalized) return 0;
  const value = parseFloat(normalized);
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

function draftDollarValue(cents?: number) {
  if (typeof cents !== 'number') return '';
  return formatAmount(cents).replace(/^\$/, '');
}

// Component-scoped helpers (closure over accessToken/signIn via props isn't available here),
// so we attach them to the component via inline definitions above where they are used.
