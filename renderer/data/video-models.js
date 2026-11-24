// The AI video models the agent can use to turn stills into clips, in three tiers.
// Shared by the window (window.SVE_VIDEO_MODELS) and the main process (require).
// Prices are fal.ai list prices, read with `genmedia pricing` on 2026-11-24. fal bills in US dollars,
// so "credits" here are dollars. Check them again when a model changes: newer versions of
// Seedance, Kling and Veo come out often.
(function (root) {
  const CLIP_SECONDS = 30; // clip time in a typical 30 to 45 second social video
  const tiers = [
    {
      id: 'best',
      tier: 'Best',
      grade: 'Highest quality',
      model: 'Seedance 2.5',
      endpoint: 'bytedance/seedance-2.5/image-to-video',
      perSecond: 0.46,
      clip: 5,
      note: 'Most expensive. The best results in one shot, with lip sync and sound. Highly recommended if cost is not an issue.',
      detail: 'About $0.46 a second at 720p, about $1.04 a second at 1080p. Native lip-synced speech and sound.',
      settings: 'resolution 720p (1080p when the person asks for it), generate_audio on, duration 4 to 30 seconds'
    },
    {
      id: 'great',
      tier: 'Great',
      grade: 'Very good quality',
      model: 'Kling 4.0',
      endpoint: 'kling/v4/image-to-video',
      perSecond: 0.16,
      clip: 5,
      note: 'Moderate price, decent speed, very good quality. Strong motion at 1080p.',
      detail: 'About $0.16 a second at 1080p. No built-in voice: add speech with the person\'s ElevenLabs voice.',
      settings: 'resolution 1080p, duration 3 to 30 seconds; no audio, so add voice and lip sync separately'
    },
    {
      id: 'good',
      tier: 'Good',
      grade: 'Good quality',
      model: 'Veo 3.1 Fast',
      endpoint: 'fal-ai/veo3.1/fast/image-to-video',
      perSecond: 0.15,
      clip: 8,
      note: 'Fast and affordable. Good for drafts and simple talking shots, with lip sync and sound.',
      detail: 'About $0.15 a second at 720p, in 4, 6 or 8 second clips. Lip-synced speech and sound.',
      settings: 'resolution 720p, duration 4s, 6s or 8s, generate_audio on'
    }
  ];
  const money = n => '$' + (n < 10 ? n.toFixed(2) : Math.round(n));
  for (const t of tiers) {
    t.perClip = money(t.perSecond * t.clip);
    t.perVideo = money(t.perSecond * CLIP_SECONDS);
  }
  const DEFAULT = 'best';
  const byId = id => tiers.find(t => t.id === id) || tiers.find(t => t.id === DEFAULT);

  // The rule the agent reads, for every video the editor makes.
  function promptLine(id) {
    const chosen = byId(id);
    const list = tiers.map(t => `${t.tier} = ${t.model} (${t.endpoint}): ${t.grade.toLowerCase()}, about $${t.perSecond.toFixed(2)} a second, about ${t.perClip} per ${t.clip}-second clip, about ${t.perVideo} for a ${CLIP_SECONDS}-second video. ${t.note} Settings: ${t.settings}.`).join(' | ');
    return [
      `AI video clips: the person chose ${chosen.tier}, ${chosen.model} (${chosen.endpoint}). Use it for every image-to-video or text-to-video clip, whatever the toolkit or a format names.`,
      `The three choices: ${list}`,
      'Before you generate any video clip, show the person the three choices as a short list (tier, model, quality, cost per clip, and your estimate for this video from the number and length of clips you plan), mark the one they chose, and wait for their go-ahead. They pay in fal.ai credits (US dollars). If they pick another tier, use that one.',
      'Stills (Nano Banana 2.1), voice (ElevenLabs) and music cost extra but little; say so in one line.'
    ].join(' ');
  }

  const api = { tiers, DEFAULT, CLIP_SECONDS, byId, promptLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SVE_VIDEO_MODELS = api;
})(typeof window !== 'undefined' ? window : globalThis);
