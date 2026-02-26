const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Gemini API via SDK officiel (gratuit — aistudio.google.com)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;
const GEMINI_MODEL = 'gemini-2.5-flash';

let genAI = null;
if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
}

async function callGemini(systemPrompt, userMessage, maxTokens = 4096) {
  if (!genAI) throw new Error('GEMINI_API_KEY manquante');
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL, provider: 'gemini-sdk',
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 }
  });
  const result = await model.generateContent(userMessage);
  return result.response.text().trim();
}

// =====================
// SYSTEM PROMPTS
// =====================

const SYSTEM_PROMPT_CLIENT = `Tu es un expert juridique français qui défend les intérêts du CLIENT (acheteur de la prestation). Analyse ce contrat du point de vue du client et identifie tout ce qui le désavantage. Réponds UNIQUEMENT en JSON valide:
{
  "risques": ["risque pour le client 1", "risque 2"],
  "manquantes": ["protection manquante pour le client 1", "protection 2"],
  "resume": "Résumé en 3-5 phrases du contrat vu du côté client",
  "suggestions": ["amélioration pour mieux protéger le client 1", "suggestion 2"]
}
Ne réponds qu'avec le JSON, sans texte avant ou après, sans balises markdown.`;

const SYSTEM_PROMPT_PRESTATAIRE = `Tu es un expert juridique français qui défend les intérêts du PRESTATAIRE (freelance/fournisseur). Analyse ce contrat du point de vue du prestataire et identifie tout ce qui le désavantage. Réponds UNIQUEMENT en JSON valide:
{
  "risques": ["risque pour le prestataire 1", "risque 2"],
  "manquantes": ["protection manquante pour le prestataire 1", "protection 2"],
  "resume": "Résumé en 3-5 phrases du contrat vu du côté prestataire",
  "suggestions": ["amélioration pour mieux protéger le prestataire 1", "suggestion 2"]
}
Ne réponds qu'avec le JSON, sans texte avant ou après, sans balises markdown.`;

const SYSTEM_PROMPT_REWRITE = `Tu es un expert juridique français. Réécris ce contrat EN ENTIER en corrigeant tous les déséquilibres, en ajoutant les clauses manquantes, et en le rendant équitable pour les deux parties (avec une protection renforcée pour le rôle indiqué). Utilise un langage juridique correct mais accessible. Conserve la structure du contrat original (articles, parties, objet...) mais améliore chaque clause. Réponds UNIQUEMENT avec le texte du contrat réécrit, sans commentaires ni explications.`;

const SYSTEM_PROMPT_GENERATE = `Tu es un expert juridique français. Génère un contrat complet et juridiquement solide basé sur la description fournie. Le contrat doit être conforme au droit français, couvrir tous les aspects essentiels, et être équilibré. Format: contrat professionnel avec articles numérotés, parties clairement définies, clauses standards FR incluses (confidentialité, PI, résiliation, responsabilité, paiement, juridiction). Réponds UNIQUEMENT avec le texte du contrat, sans commentaires.`;

// =====================
// POST /api/analyze
// =====================
app.post('/api/analyze', async (req, res) => {
  const { contractText, role } = req.body;

  if (!contractText || contractText.trim().length < 10)
    return res.status(400).json({ error: 'Le texte du contrat est trop court ou manquant.' });
  if (contractText.length > 100000)
    return res.status(400).json({ error: 'Le contrat est trop long (max 100 000 caractères).' });
  if (!genAI)
    return res.status(500).json({ error: 'Clé API manquante. Configurez GEMINI_API_KEY.' });

  const systemPrompt = role === 'prestataire' ? SYSTEM_PROMPT_PRESTATAIRE : SYSTEM_PROMPT_CLIENT;

  try {
    const rawText = await callGemini(systemPrompt, `Voici le contrat à analyser:\n\n${contractText}`);

    let jsonText = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonText = jsonMatch[1].trim();

    const result = JSON.parse(jsonText);

    if (!result.risques || !result.manquantes || !result.resume || !result.suggestions)
      throw new Error('Réponse JSON incomplète');

    result.free = true;
    res.json(result);
  } catch (err) {
    console.error('Erreur analyse:', err.message);
    if (err.name === 'SyntaxError')
      return res.status(500).json({ error: 'Erreur de parsing JSON. Veuillez réessayer.' });
    res.status(500).json({ error: `Erreur lors de l'analyse: ${err.message}` });
  }
});

// =====================
// POST /api/rewrite
// =====================
app.post('/api/rewrite', async (req, res) => {
  const { contractText, role } = req.body;

  if (!contractText || contractText.trim().length < 10)
    return res.status(400).json({ error: 'Le texte du contrat est trop court ou manquant.' });
  if (!genAI)
    return res.status(500).json({ error: 'Clé API manquante. Configurez GEMINI_API_KEY.' });

  const roleLabel = role === 'prestataire' ? 'prestataire (freelance/fournisseur)' : 'client (acheteur)';

  try {
    const contract = await callGemini(
      SYSTEM_PROMPT_REWRITE,
      `Rôle à protéger en priorité: ${roleLabel}\n\nVoici le contrat à réécrire:\n\n${contractText}`,
      8192
    );
    res.json({ contract });
  } catch (err) {
    console.error('Erreur réécriture:', err.message);
    res.status(500).json({ error: `Erreur lors de la réécriture: ${err.message}` });
  }
});

// =====================
// POST /api/generate
// =====================
app.post('/api/generate', async (req, res) => {
  const { description, role, contractType } = req.body;

  if (!description || description.trim().length < 10)
    return res.status(400).json({ error: 'La description est trop courte ou manquante.' });
  if (!genAI)
    return res.status(500).json({ error: 'Clé API manquante. Configurez GEMINI_API_KEY.' });

  const roleLabel = role === 'prestataire' ? 'prestataire (freelance/fournisseur)' : 'client (acheteur)';
  const typeLabel = contractType || 'Prestation de services';

  try {
    const contract = await callGemini(
      SYSTEM_PROMPT_GENERATE,
      `Type de contrat: ${typeLabel}\nRôle de l'utilisateur: ${roleLabel}\n\nDescription:\n${description}`,
      8192
    );
    res.json({ contract });
  } catch (err) {
    console.error('Erreur génération:', err.message);
    res.status(500).json({ error: `Erreur lors de la génération: ${err.message}` });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.1.0', model: GEMINI_MODEL, provider: 'gemini-sdk', provider: 'gemini' });
});

// Catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚖️  ContratClair server running on http://localhost:${PORT}`);
  console.log(`🔑  Gemini SDK: ${genAI ? 'configured ✓' : 'MISSING ✗'}`);
});
