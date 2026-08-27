const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireLogin } = require('../middleware/auth');
const { createDocumentUpload, hasExpectedSignature, removeUploadedFile } = require('../middleware/uploads');
const { extractDocumentText, parseResume, matchCandidate } = require('../services/ai');

const upload = createDocumentUpload();
router.use(requireLogin);

function isAdmin(user) {
  return user.role === 'admin' || user.role === 'super_admin';
}

function uploadOne(req, res) {
  return new Promise((resolve, reject) => upload.single('cv')(req, res, err => err ? reject(err) : resolve()));
}

router.post('/parse-resume', async (req, res) => {
  let file;
  try {
    await uploadOne(req, res);
    file = req.file;
    if (!file) return res.status(400).json({ error: 'Please attach a CV file.' });
    if (!(await hasExpectedSignature(file))) return res.status(400).json({ error: 'Uploaded document content does not match its file type.' });
    const text = await extractDocumentText(file);
    const data = await parseResume(text);
    res.json({ data, message: 'Resume parsed successfully.' });
  } catch (err) {
    console.error('AI resume parsing error:', err);
    const status = /not configured|Only valid|attach|match its file type|readable text|Legacy/.test(err.message || '') ? 400 : 502;
    res.status(status).json({ error: err.message || 'Unable to parse this resume.' });
  } finally {
    if (file) await removeUploadedFile(file);
  }
});

router.post('/match', async (req, res) => {
  const requirementId = Number.parseInt(req.body.requirement_id, 10);
  const resourceId = Number.parseInt(req.body.resource_id, 10);
  if (!Number.isInteger(requirementId) || requirementId <= 0 || !Number.isInteger(resourceId) || resourceId <= 0) {
    return res.status(400).json({ error: 'Valid requirement_id and resource_id are required.' });
  }

  try {
    const requirementParams = [requirementId];
    let requirementSql = 'SELECT id,title,jd,budget,created_by FROM crm_requirements WHERE id=?';
    if (!isAdmin(req.session.user)) {
      requirementSql += ' AND created_by=?';
      requirementParams.push(req.session.user.id);
    }
    const [[requirement], [resource]] = await Promise.all([
      pool.query(requirementSql, requirementParams),
      pool.query('SELECT id,resource_name,title,skills,experience_years,current_location,preferred_location,salary_lpa FROM crm_resources WHERE id=?', [resourceId])
    ]);
    if (!requirement.length) return res.status(404).json({ error: 'Requirement not found or not accessible.' });
    if (!resource.length) return res.status(404).json({ error: 'Resource not found.' });
    const data = await matchCandidate(requirement[0], resource[0]);
    const score = Math.max(0, Math.min(100, Number.parseInt(data.score, 10) || 0));
    res.json({ data: { ...data, score }, requirement_id: requirementId, resource_id: resourceId });
  } catch (err) {
    console.error('AI candidate match error:', err);
    const status = /not configured/.test(err.message || '') ? 400 : 502;
    res.status(status).json({ error: err.message || 'Unable to calculate candidate match.' });
  }
});

module.exports = router;
