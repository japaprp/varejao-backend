import fs from 'fs';
import path from 'path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const SAFE_IMAGE_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
});

export function resolveSafeImageExtension(mimetype = '') {
  return SAFE_IMAGE_EXTENSIONS[String(mimetype).toLowerCase()] || null;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const extension = resolveSafeImageExtension(file.mimetype);
    if (!extension) return cb(new Error('Formato de imagem nao permitido'));
    return cb(null, `${randomUUID()}.${extension}`);
  }
});

function fileFilter(_req, file, cb) {
  if (resolveSafeImageExtension(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Apenas imagens JPEG, PNG, WebP ou GIF sao permitidas'));
  }
}

export const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });
