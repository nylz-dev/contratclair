const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Anthropic client — supports both direct API keys (sk-ant-api-...) and OAuth tokens (sk-ant-oat...)
const apiKeyRaw = process.env.ANTHROPIC_API_KEY || null;
const isOAuthToken = apiKeyRaw && apiKeyRaw.startsWith('sk-ant-oat');

// OAuth tokens require special Claude Code beta headers
const anthropic = new Anthropic(
  isOAuthToken
    ? {
        authToken: apiKeyRaw,
        apiKey: null,
        dangerouslyAllowBrowser: true,
        defaultHeaders: {
          'accept': 'application/json',
          'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14',
          'user-agent': 'claude-cli/2.1.2 (external, cli)',
          'x-app': 'cli',
        },
      }
    : { apiKey: apiKeyRaw }
);

// Helper: build system prompt with optional Claude Code identity prefix
function buildSystemPrompt(base) {
  return isOAuthToken ? `You are Claude Code, Anthropic's official CLI for Claude.\n\n${base}` : base;
}

// =====================
// SYSTEM PROMPTS
// =====================

const SYSTEM_PROMPT_CLIENT = `Tu es un expert juridique français qui défend les intérêts du CLIENT (acheteur de la prestation). Analyse ce contrat du point de vue du client et identifie tout ce qui le désavantage. Réponds UNIQUEMENT en JSON valide:
{
  "risques": ["risque pour le client 1", ...],
  "manquantes": ["protection manquante pour le client 1", ...],
  "resume": "Résumé en 3-5 phrases du contrat vu du côté client",
  "suggestions": ["amélioration pour mieux protéger le client 1", ...]
}`;

const SYSTEM_PROMPT_PRESTATAIRE = `Tu es un expert juridique français qui défend les intérêts du PRESTATAIRE (freelance/fournisseur). Analyse ce contrat du point de vue du prestataire et identifie tout ce qui le désavantage. Réponds UNIQUEMENT en JSON valide:
{
  "risques": ["risque pour le prestataire 1", ...],
  "manquantes": ["protection manquante pour le prestataire 1", ...],
  "resume": "Résumé en 3-5 phrases du contrat vu du côté prestataire",
  "suggestions": ["amélioration pour mieux protéger le prestataire 1", ...]
}`;

const SYSTEM_PROMPT_REWRITE = `Tu es un expert juridique français. On t'a soumis un contrat avec des clauses problématiques. Réécris ce contrat EN ENTIER en corrigeant tous les déséquilibres, en ajoutant les clauses manquantes, et en le rendant équitable pour les deux parties (avec une protection renforcée pour le rôle indiqué). Utilise un langage juridique correct mais accessible. Conserve la structure du contrat original (articles, parties, objet...) mais améliore chaque clause. Réponds UNIQUEMENT avec le texte du contrat réécrit, sans commentaires ni explications.`;

const SYSTEM_PROMPT_GENERATE = `Tu es un expert juridique français. Génère un contrat complet et juridiquement solide basé sur la description fournie. Le contrat doit être conforme au droit français, couvrir tous les aspects essentiels, et être équilibré. Format: contrat professionnel avec articles numérotés, parties clairement définies, clauses standards FR incluses (confidentialité, PI, résiliation, responsabilité, paiement, juridiction). Réponds UNIQUEMENT avec le texte du contrat, sans commentaires.`;

// =====================
// POST /api/analyze
// =====================
app.post('/api/analyze', async (req, res) => {
  const { contractText, role } = req.body;

  if (!contractText || contractText.trim().length < 10) {
    return res.status(400).json({ error: 'Le texte du contrat est trop court ou manquant.' });
  }

  if (contractText.length > 100000) {
    return res.status(400).json({ error: 'Le contrat est trop long (max 100 000 caractères).' });
  }

  const BASE_PROMPT = role === 'prestataire' ? SYSTEM_PROMPT_PRESTATAIRE : SYSTEM_PROMPT_CLIENT;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: buildSystemPrompt(BASE_PROMPT),
      messages: [
        {
          role: 'user',
          content: `Voici le contrat à analyser:\n\n${contractText}`,
        },
      ],
    });

    const rawText = message.content[0].text.trim();

    let jsonText = rawText;
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonText);

    if (!result.risques || !result.manquantes || !result.resume || !result.suggestions) {
      throw new Error('Réponse JSON incomplète de l\'API');
    }

    // v3: freemium — analysis is always free
    result.free = true;

    res.json(result);
  } catch (err) {
    console.error('Erreur analyse:', err.message);

    if (err.name === 'SyntaxError') {
      return res.status(500).json({ error: 'Erreur de parsing JSON. Veuillez réessayer.' });
    }

    if (err.status === 401) {
      return res.status(500).json({ error: 'Clé API invalide. Vérifiez ANTHROPIC_API_KEY.' });
    }

    res.status(500).json({ error: `Erreur lors de l'analyse: ${err.message}` });
  }
});

// =====================
// POST /api/rewrite
// =====================
app.post('/api/rewrite', async (req, res) => {
  const { contractText, role } = req.body;

  if (!contractText || contractText.trim().length < 10) {
    return res.status(400).json({ error: 'Le texte du contrat est trop court ou manquant.' });
  }

  if (contractText.length > 100000) {
    return res.status(400).json({ error: 'Le contrat est trop long (max 100 000 caractères).' });
  }

  const roleLabel = role === 'prestataire' ? 'prestataire (freelance/fournisseur)' : 'client (acheteur)';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: buildSystemPrompt(SYSTEM_PROMPT_REWRITE),
      messages: [
        {
          role: 'user',
          content: `Rôle à protéger en priorité: ${roleLabel}\n\nVoici le contrat à réécrire:\n\n${contractText}`,
        },
      ],
    });

    const rewrittenContract = message.content[0].text.trim();
    res.json({ contract: rewrittenContract });
  } catch (err) {
    console.error('Erreur réécriture:', err.message);

    if (err.status === 401) {
      return res.status(500).json({ error: 'Clé API invalide. Vérifiez ANTHROPIC_API_KEY.' });
    }

    res.status(500).json({ error: `Erreur lors de la réécriture: ${err.message}` });
  }
});

// =====================
// POST /api/generate
// =====================
app.post('/api/generate', async (req, res) => {
  const { description, role, contractType } = req.body;

  if (!description || description.trim().length < 10) {
    return res.status(400).json({ error: 'La description est trop courte ou manquante.' });
  }

  const roleLabel = role === 'prestataire' ? 'prestataire (freelance/fournisseur)' : 'client (acheteur)';
  const typeLabel = contractType || 'Prestation de services';

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      system: buildSystemPrompt(SYSTEM_PROMPT_GENERATE),
      messages: [
        {
          role: 'user',
          content: `Type de contrat: ${typeLabel}\nRôle de l'utilisateur: ${roleLabel}\n\nDescription de la situation:\n${description}`,
        },
      ],
    });

    const generatedContract = message.content[0].text.trim();
    res.json({ contract: generatedContract });
  } catch (err) {
    console.error('Erreur génération:', err.message);

    if (err.status === 401) {
      return res.status(500).json({ error: 'Clé API invalide. Vérifiez ANTHROPIC_API_KEY.' });
    }

    res.status(500).json({ error: `Erreur lors de la génération: ${err.message}` });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', model: 'claude-sonnet-4-6' });
});

// Catch-all: serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`⚖️  ContratClair server running on http://localhost:${PORT}`);
  const keyInfo = apiKeyRaw
    ? `configured ✓ (${isOAuthToken ? 'OAuth token' : 'API key'})`
    : 'MISSING ✗';
  console.log(`🔑  Auth: ${keyInfo}`);
});
