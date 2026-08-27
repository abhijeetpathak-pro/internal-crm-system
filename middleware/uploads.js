const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');

const ROOT = path.join(__dirname, '..', 'uploads');
const CV_DIR = path.join(ROOT, 'cvs');
const AVATAR_DIR = path.join(ROOT, 'avatars');
fs.mkdirSync(CV_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

function randomFilename(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return `${crypto.randomBytes(16).toString('hex')}${ext}`;
}

function documentFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = {
    '.pdf': ['application/pdf'],
    '.doc': ['application/msword', 'application/octet-stream'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream']
  };
  if (!allowed[ext] || !allowed[ext].includes(file.mimetype)) {
    return cb(new Error('Only valid PDF, DOC, or DOCX files are allowed.'));
  }
  cb(null, true);
}

function imageFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };
  if (!allowed[ext] || allowed[ext] !== file.mimetype) {
    return cb(new Error('Only PNG, JPG, JPEG, WEBP, or GIF images are allowed.'));
  }
  cb(null, true);
}

function createDocumentUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: CV_DIR,
      filename: (req, file, cb) => cb(null, randomFilename(file))
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: documentFilter
  });
}

function createImageUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: AVATAR_DIR,
      filename: (req, file, cb) => cb(null, `user-${req.session.user.id}-${randomFilename(file)}`)
    }),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: imageFilter
  });
}

async function hasExpectedSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, header.length, 0);
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.pdf') return header.toString('ascii', 0, 5) === '%PDF-';
    if (ext === '.doc') return header.slice(0, 8).equals(Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]));
    if (ext === '.docx') return header.slice(0, 2).toString('ascii') === 'PK';
    return false;
  } finally {
    await handle.close();
  }
}

async function hasExpectedImageSignature(file) {
  const handle = await fs.promises.open(file.path, 'r');
  try {
    const header = Buffer.alloc(12);
    await handle.read(header, 0, header.length, 0);
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.png') return header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
    if (ext === '.jpg' || ext === '.jpeg') return header.slice(0, 3).equals(Buffer.from([0xFF, 0xD8, 0xFF]));
    if (ext === '.gif') return ['GIF87a', 'GIF89a'].includes(header.toString('ascii', 0, 6));
    if (ext === '.webp') return header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP';
    return false;
  } finally {
    await handle.close();
  }
}

async function removeUploadedFile(file) {
  if (!file || !file.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Upload cleanup error:', err);
  }
}

module.exports = { createDocumentUpload, createImageUpload, hasExpectedSignature, hasExpectedImageSignature, removeUploadedFile };
