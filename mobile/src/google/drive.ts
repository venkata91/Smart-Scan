// Minimal Drive client using fetch + bearer token.

export async function ensureFolder(pathParts: string[], token: string): Promise<string> {
  // For MVP: flatten into a single folder under App root named by joined path.
  // Production: create nested folders by searching parent IDs.
  const name = pathParts.join(' / ');
  const q = encodeURIComponent(`name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;

  const metaRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const meta = await metaRes.json();
  return meta.id as string;
}

export async function uploadEncryptedBlob(params: {
  folderId: string;
  name: string; // final file name to create in Drive
  bytes: Uint8Array;
  token: string;
}): Promise<string> {
  const metadata = { name: params.name, parents: [params.folderId] };
  const boundary = 'foo_bar_baz_' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n';

  const tail = `\r\n--${boundary}--`;
  const blob = new Blob([body, params.bytes, tail], { type: 'multipart/related; boundary=' + boundary });

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${params.token}` },
    body: blob as any,
  });
  const data = await res.json();
  return data.id as string;
}
