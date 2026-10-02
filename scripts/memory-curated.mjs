// Selezione curata delle memorie condivise, pubblicata dal server e firmata
// dall'amministratore. La usano memory-trust.mjs (scrive) e memory-sync.mjs (legge).
//
//   memories/shared/curated.json      { version, generatedAt, publish: [Memory], retract: [id] }
//   memories/shared/curated.json.sig  firma ed25519 (base64) dei byte di curated.json
//   config/trust-admin.pub            chiave pubblica dell'amministratore (PEM)
//
// La chiave privata sta solo sul server (fuori dal repo): chi modifica
// curated.json a mano in git produce un file che i PC rifiutano.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const curatedPaths = (repoDir) => ({
  file: path.join(repoDir, 'memories', 'shared', 'curated.json'),
  sig: path.join(repoDir, 'memories', 'shared', 'curated.json.sig'),
  pub: path.join(repoDir, 'config', 'trust-admin.pub'),
});

export function signCurated(repoDir, curated, privateKeyPem) {
  const p = curatedPaths(repoDir);
  const bytes = Buffer.from(JSON.stringify(curated, null, 1) + '\n', 'utf8');
  const sig = crypto.sign(null, bytes, crypto.createPrivateKey(privateKeyPem)).toString('base64');
  fs.mkdirSync(path.dirname(p.file), { recursive: true });
  fs.writeFileSync(`${p.file}.tmp`, bytes);
  fs.writeFileSync(`${p.sig}.tmp`, sig + '\n');
  fs.renameSync(`${p.file}.tmp`, p.file);
  fs.renameSync(`${p.sig}.tmp`, p.sig);
  return p;
}

// null se non c'e' ancora una selezione; eccezione se la firma non torna
export function loadCurated(repoDir) {
  const p = curatedPaths(repoDir);
  if (!fs.existsSync(p.file)) return null;
  if (!fs.existsSync(p.pub)) throw new Error(`manca ${p.pub}: impossibile verificare curated.json`);
  if (!fs.existsSync(p.sig)) throw new Error('curated.json senza firma: rifiutato');
  const bytes = fs.readFileSync(p.file);
  const sig = Buffer.from(fs.readFileSync(p.sig, 'utf8').trim(), 'base64');
  const ok = crypto.verify(null, bytes, crypto.createPublicKey(fs.readFileSync(p.pub, 'utf8')), sig);
  if (!ok) throw new Error("firma di curated.json non valida: modificato da qualcuno che non e' l'amministratore");
  return JSON.parse(bytes.toString('utf8'));
}

// Memorie personali: non lasciano mai il PC (ne' nel file di sync ne' al server)
export const isPersonal = (m) => (m.concepts || []).some((c) => String(c).toLowerCase() === 'personale')
  || String(m.project || '').toLowerCase().startsWith('personale');
