// ---------------------------------------------------------------------------
// Configuration multer partagée (justificatifs de congé).
//
// Extrait de routes/expenses.ts, qui garde sa propre instance pour ne pas
// toucher à du code xFINT1 qui fonctionne — les deux configurations doivent
// rester alignées.
// ---------------------------------------------------------------------------

import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 Mo
export const MAX_FILES_PER_REQUEST = 10;

export const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      void mkdir(UPLOAD_DIR, { recursive: true })
        .then(() => cb(null, UPLOAD_DIR))
        .catch((err: Error) => cb(err, UPLOAD_DIR));
    },
    // Nom disque aléatoire : on ne fait jamais confiance au nom fourni par le
    // client (traversée de chemin, collisions). Le vrai nom va en base.
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_REQUEST },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error(`Type de fichier non autorisé : ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

/**
 * Chemin absolu d'une pièce jointe, renormalisé pour écarter toute tentative
 * de traversée de chemin. `null` si le chemin sort du dossier d'upload.
 */
export function resolveUploadPath(filePath: string): string | null {
  const absolute = path.join(UPLOAD_DIR, path.basename(filePath));
  return absolute.startsWith(UPLOAD_DIR + path.sep) ? absolute : null;
}
