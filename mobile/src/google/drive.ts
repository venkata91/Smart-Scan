// Minimal Drive client using fetch + bearer token.

async function findFolder(name: string, parentId: string, token: string): Promise<string | null> {
  const qParts = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${name.replace(/'/g, "\\'")}'`,
    `'${parentId}' in parents`,
    'trashed=false',
  ];
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(qParts.join(' and '))}&fields=files(id,name)`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string, token: string): Promise<string> {
  const metaRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  const meta = await metaRes.json();
  return meta.id as string;
}

export async function ensureFolder(pathParts: string[], token: string): Promise<string> {
  // Create nested folder structure under Drive root
  let parentId = 'root';
  for (const part of pathParts) {
    const existing = await findFolder(part, parentId, token);
    parentId = existing ?? (await createFolder(part, parentId, token));
  }
  return parentId;
}

export async function uploadEncryptedBlob(params: {
  folderId: string;
  name: string; // final file name to create in Drive (e.g., base.pdf.enc)
  bytes: Uint8Array;
  token: string;
  originalExt?: string;
  contentType?: string; // defaults to application/octet-stream
}): Promise<string> {
  const metadata: Record<string, any> = { name: params.name, parents: [params.folderId] };
  if (params.originalExt) {
    metadata.appProperties = { originalExt: params.originalExt };
  }
  const boundary = '----hsavault-' + Math.random().toString(36).slice(2);
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    `Content-Type: ${params.contentType || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;

  const contentType = `multipart/related; boundary=${boundary}`;
  const bodyBlob = new Blob([head, params.bytes, tail], { type: contentType });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.token}`,
      'Content-Type': contentType,
    },
    body: bodyBlob as any,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Drive upload failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.id as string;
}

// List uploaded receipt metadata sidecar files (plain JSON)
export async function listReceiptMetaFiles(token: string, opts?: { pageToken?: string; pageSize?: number }): Promise<{ files: Array<{ id: string; name: string; modifiedTime?: string }>; nextPageToken?: string }>{
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', "name contains '.meta.json' and trashed=false");
  url.searchParams.set('orderBy', 'modifiedTime desc');
  url.searchParams.set('fields', 'nextPageToken, files(id,name,modifiedTime)');
  url.searchParams.set('pageSize', String(opts?.pageSize ?? 20));
  if (opts?.pageToken) url.searchParams.set('pageToken', opts.pageToken);
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = await res.json();
  const files = (data.files || []).map((f: any) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }));
  return { files, nextPageToken: data.nextPageToken };
}

export async function getFileText(fileId: string, token: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
  return await res.text();
}

// Update (replace) the file content with provided text
export async function updateFileText(params: {
  fileId: string;
  token: string;
  text: string;
  contentType?: string; // default application/json
}): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${params.fileId}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': params.contentType || 'application/json',
      },
      body: params.text as any,
    }
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Drive update failed: ${res.status} ${msg}`);
  }
}

export async function deleteFile(fileId: string, token: string): Promise<void> {
  if (!fileId) return;
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const msg = await res.text();
    throw new Error(`Drive delete failed: ${res.status} ${msg}`);
  }
}
