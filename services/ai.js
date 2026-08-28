const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');

const MAX_TEXT_CHARS = 45000;
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx']);

function cleanText(value, max = MAX_TEXT_CHARS) {
  return String(value || '').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

async function extractDocumentText(file) {
  if (!file || !file.path) throw new Error('No document supplied.');
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error('Only PDF, DOC, and DOCX files can be parsed.');
  const buffer = await fs.promises.readFile(file.path);
  let text = '';
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else {
    throw new Error('Legacy .doc parsing is not supported by the built-in extractor. Convert it to PDF or DOCX first.');
  }
  const cleaned = cleanText(text);
  if (!cleaned) throw new Error('No readable text was found in this document.');
  return cleaned;
}

function aiConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  const baseUrl = (process.env.OPENAI_API_BASE || process.env.AI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || 'gpt-5-mini';
  if (!apiKey) throw new Error('AI is not configured. Add OPENAI_API_KEY and optionally AI_MODEL to the server environment.');
  return { apiKey, baseUrl, model };
}

async function callStructuredAI(system, user, schema) {
  const { apiKey, baseUrl, model } = aiConfig();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 1800,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name: 'crm_ai_result', strict: true, schema } }
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('AI provider error:', response.status, detail.slice(0, 500));
    throw new Error('AI provider request failed.');
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI provider returned an empty response.');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('AI provider returned invalid structured data.');
  }
}

async function parseResume(text) {
  const schema = {
    type: 'object',
    properties: {
      resource_name: { type: 'string' },
      title: { type: 'string' },
      email: { type: 'string' },
      contact_number: { type: 'string' },
      skills: { type: 'string' },
      experience_years: { type: 'number' },
      current_location: { type: 'string' },
      preferred_location: { type: 'string' },
      summary: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['resource_name', 'title', 'email', 'contact_number', 'skills', 'experience_years', 'current_location', 'preferred_location', 'summary', 'confidence'],
    additionalProperties: false
  };
  return callStructuredAI(
    'You extract structured candidate data from resumes for an internal staffing CRM. Use empty strings or 0 when information is absent. Never invent facts. Keep skills as a comma-separated list, experience_years as a non-negative number, and confidence between 0 and 1. Return JSON only.',
    `Extract the candidate fields from this resume text. Do not include sensitive inferences such as age, gender, religion, caste, disability, marital status, or any protected characteristic.\n\nRESUME:\n${cleanText(text)}`,
    schema
  );
}

async function matchCandidate(requirement, resource) {
  const schema = {
    type: 'object',
    properties: {
      score: { type: 'integer' },
      recommendation: { type: 'string', enum: ['Strong match', 'Potential match', 'Weak match'] },
      matched_skills: { type: 'array', items: { type: 'string' } },
      missing_skills: { type: 'array', items: { type: 'string' } },
      explanation: { type: 'string' }
    },
    required: ['score', 'recommendation', 'matched_skills', 'missing_skills', 'explanation'],
    additionalProperties: false
  };
  return callStructuredAI(
    'You compare a staffing requirement with a candidate profile. Score only job-relevant evidence: skills, title, experience, location, and salary when provided. Do not infer or use protected characteristics. Give a concise, evidence-based explanation. Return JSON only.',
    `REQUIREMENT\nTitle: ${cleanText(requirement.title, 255)}\nJD: ${cleanText(requirement.jd, 18000)}\nBudget: ${cleanText(requirement.budget, 255)}\n\nCANDIDATE\nName: ${cleanText(resource.resource_name, 255)}\nTitle: ${cleanText(resource.title, 255)}\nSkills: ${cleanText(resource.skills, 1000)}\nExperience years: ${resource.experience_years ?? ''}\nCurrent location: ${cleanText(resource.current_location, 255)}\nPreferred location: ${cleanText(resource.preferred_location, 255)}\nSalary: ${resource.salary_lpa ?? ''}`,
    schema
  );
}

module.exports = { extractDocumentText, parseResume, matchCandidate };
