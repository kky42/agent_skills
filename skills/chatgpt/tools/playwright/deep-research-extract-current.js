async page => {
  await page.waitForTimeout(2000);
  const frames = page.frames();
  const candidates = [];
  for (const [index, frame] of frames.entries()) {
    try {
      const text = await frame.locator('body').innerText({ timeout: 3000 });
      const normalized = String(text || '').replace(/\n{3,}/g, '\n\n').trim();
      if (normalized.length > 500) candidates.push({ index, url: frame.url(), text: normalized });
    } catch (error) {
      candidates.push({ index, url: frame.url(), error: String(error?.message || error).slice(0, 500), text: '' });
    }
  }
  candidates.sort((a, b) => (b.text || '').length - (a.text || '').length);
  const best = candidates[0] || { index: -1, url: '', text: '' };
  return JSON.stringify({
    pageUrl: page.url(),
    frameIndex: best.index,
    frameUrl: best.url,
    textLength: (best.text || '').length,
    text: best.text || '',
    frames: frames.map((frame, index) => ({ index, url: frame.url(), name: frame.name() })),
  });
}
