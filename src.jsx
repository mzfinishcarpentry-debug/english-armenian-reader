import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import mammoth from 'mammoth';
import * as pdfjs from 'pdfjs-dist';
import ePub from 'epubjs';
import './style.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;

const demo = `Every morning, Emma walked through the beautiful garden near her house. She felt grateful for the peaceful surroundings. Reading books helped her discover new ideas and improve her English.`;
const samples = {
  beautiful: ['գեղեցիկ', 'What a beautiful day!'],
  garden: ['այգի', 'The flowers grow in the garden.'],
  grateful: ['երախտապարտ', 'I am grateful for your help.'],
  peaceful: ['խաղաղ', 'It was a peaceful evening.'],
  discover: ['բացահայտել', 'We discover something new every day.'],
  reading: ['ընթերցանություն', 'Reading helps you learn.']
};

const normalize = word => word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '').toLowerCase();

function sentenceAt(text, offset) {
  const before = text.slice(0, offset);
  const after = text.slice(offset);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('!'), before.lastIndexOf('?'), before.lastIndexOf('\n')) + 1;
  const next = after.search(/[.!?\n]/);
  const end = next < 0 ? text.length : offset + next + 1;
  return text.slice(start, end).trim().slice(0, 500);
}

// Free MyMemory translations are approximate. Cache only successful responses.
const CACHE_KEY = 'reader-translation-cache-v06';
function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; }
  catch { return {}; }
}
function getCachedTranslation(input) { return readCache()[input.trim().toLowerCase()] || ''; }
function cacheTranslation(input, result) {
  const cache = readCache();
  cache[input.trim().toLowerCase()] = result;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full */ }
}
async function translateFree(input) {
  const query = input.trim();
  if (!query) return '';
  const cached = getCachedTranslation(query);
  if (cached) return cached;
  const response = await fetch('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(query.slice(0, 450)) + '&langpair=en|hy');
  if (!response.ok) throw Error('Translation service unavailable');
  const data = await response.json();
  const value = data.responseData?.translatedText?.trim() || '';
  if (Number(data.responseStatus) !== 200 || !value || /MYMEMORY WARNING|QUOTA|LIMIT REACHED/i.test(value)) throw Error('Translation unavailable');
  cacheTranslation(query, value);
  return value;
}

function App() {
  const [text, setText] = useState(localStorage.getItem('reader-text') || demo);
  const [filename, setFilename] = useState(localStorage.getItem('reader-name') || 'Sample Story');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [selected, setSelected] = useState('beautiful');
  const [definition, setDefinition] = useState(samples.beautiful);
  const [example, setExample] = useState(samples.beautiful[1]);
  const [sentenceTranslation, setSentenceTranslation] = useState('');
  const [sentenceBusy, setSentenceBusy] = useState(false);
  const [translationNote, setTranslationNote] = useState('');
  const [editMeaning, setEditMeaning] = useState(false);
  const [meaningDraft, setMeaningDraft] = useState('');
  const [corrections, setCorrections] = useState(() => {
    try { return JSON.parse(localStorage.getItem('reader-translation-corrections-v06') || '{}') || {}; } catch { return {}; }
  });
  const [saved, setSaved] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem('reader-words') || '[]'); return Array.isArray(value) ? value : []; }
    catch { return []; }
  });
  const [vocabSearch, setVocabSearch] = useState('');
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [learningMessage, setLearningMessage] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [size, setSize] = useState(20);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobileWordOpen, setMobileWordOpen] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    localStorage.setItem('reader-text', text);
    localStorage.setItem('reader-name', filename);
  }, [text, filename]);
  useEffect(() => localStorage.setItem('reader-words', JSON.stringify(saved)), [saved]);
  useEffect(() => localStorage.setItem('reader-translation-corrections-v06', JSON.stringify(corrections)), [corrections]);

  function loadPastedStory() {
    if (!pasteText.trim()) {
      setError('Paste some story text before opening it.');
      return;
    }
    if (!window.confirm('Replace the currently open story? Your saved vocabulary will stay.')) return;
    requestId.current++;
    setText(pasteText);
    setFilename(pasteTitle.trim() || 'Pasted Story');
    setSelected('');
    setDefinition(null);
    setExample('');
    setSentenceTranslation('');
    setTranslationNote('');
    setMobileWordOpen(false);
    setError('');
    setPasteOpen(false);
    setPasteTitle('');
    setPasteText('');
    window.scrollTo(0, 0);
  }

  async function upload(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setError('');
    try {
      const ext = f.name.split('.').pop().toLowerCase();
      let result = '';
      if (ext === 'txt') result = await f.text();
      else if (ext === 'docx') result = (await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })).value;
      else if (ext === 'pdf') {
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
        for (let i = 1; i <= doc.numPages; i++) {
          const p = await doc.getPage(i);
          const c = await p.getTextContent();
          result += c.items.map(x => x.str).join(' ') + '\n\n';
        }
      } else if (ext === 'epub') {
        const book = ePub(await f.arrayBuffer());
        await book.ready;
        for (const item of book.spine.spineItems) {
          const doc = await book.load(item.href);
          result += (doc.body?.innerText || doc.body?.textContent || '') + '\n\n';
        }
        book.destroy();
      } else throw Error('Please select PDF, EPUB, DOCX, or TXT.');
      if (!result.trim()) throw Error('No selectable text found. Scanned images need OCR, which will be added in a later version.');
      requestId.current++;
      setText(result);
      setFilename(f.name);
      setSelected('');
      setDefinition(null);
      setExample('');
      setMobileWordOpen(false);
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusy(false); e.target.value = ''; }
  }

  async function choose(word, context = '') {
    const clean = normalize(word);
    if (!clean) return;
    const id = ++requestId.current;
    setSelected(clean);
    setMobileWordOpen(true);
    setExample(context || samples[clean]?.[1] || 'No sentence available for this saved word.');
    setSentenceTranslation('');
    setSentenceBusy(false);
    setTranslationNote('');
    setEditMeaning(false);
    const corrected = corrections[clean];
    const initial = corrected || samples[clean]?.[0] || getCachedTranslation(clean);
    setDefinition(initial ? [initial, context] : null);
    if (initial) return;
    try {
      const translated = await translateFree(clean);
      if (id === requestId.current) setDefinition([translated, context]);
    } catch {
      if (id === requestId.current) setDefinition(['Translation unavailable (check internet or try again)', '']);
    }
  }

  async function translateSentence() {
    const context = example.trim();
    if (!context || context === 'No sentence available for this saved word.') return;
    const id = requestId.current;
    setSentenceBusy(true);
    setTranslationNote('');
    try {
      const translated = await translateFree(context);
      if (id === requestId.current) setSentenceTranslation(translated);
    } catch {
      if (id === requestId.current) setTranslationNote('Sentence translation unavailable. The free service may be temporarily limited.');
    } finally {
      if (id === requestId.current) setSentenceBusy(false);
    }
  }

  function saveCorrection() {
    const value = meaningDraft.trim();
    if (!selected || !value) return;
    setCorrections(previous => ({ ...previous, [selected]: value }));
    setDefinition([value, example]);
    setSaved(previous => previous.map(item => item.word === selected ? { ...item, meaning: value } : item));
    setEditMeaning(false);
    setTranslationNote('Your corrected meaning has been saved on this device.');
  }

  function speakWord(word) {
    if (!word || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.82;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  function speak() { speakWord(selected); }

  function exportVocabulary() {
    const rows = [['English', 'Armenian', 'Example', 'Learned'], ...saved.map(x => [x.word, x.meaning, x.example || '', x.learned ? 'Yes' : 'No'])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'english-armenian-vocabulary.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function toggleLearned(word) {
    const item = saved.find(x => x.word === word);
    if (!item) return;
    setSaved(previous => previous.map(x => x.word === word ? { ...x, learned: !x.learned } : x));
    setLearningMessage(item.learned ? `Moved "${word}" back to practice.` : `"${word}" marked as learned!`);
  }
  function save() {
    if (!selected || !definition || definition[0].startsWith('Translation unavailable')) return;
    setSaved(previous => previous.some(x => x.word === selected)
      ? previous.filter(x => x.word !== selected)
      : [...previous, { word: selected, meaning: definition[0], example, learned: false }]);
  }

  const filteredWords = saved.filter(x =>
    (!reviewOnly || !x.learned) &&
    (x.word.toLowerCase().includes(vocabSearch.toLowerCase()) ||
      String(x.meaning || '').toLowerCase().includes(vocabSearch.toLowerCase()))
  );
  const reviewWords = saved.filter(x => !x.learned);
  const reviewWord = reviewWords.length ? reviewWords[reviewIndex % reviewWords.length] : null;
  function markReviewLearned() {
    if (!reviewWord) return;
    toggleLearned(reviewWord.word);
    setReviewIndex(0);
    setShowAnswer(false);
  }

  // Keep each word's original offset so we can display its real sentence.
  let offset = 0;
  const parts = text.split(/(\s+)/).map((part, i) => {
    const start = offset;
    offset += part.length;
    if (/^\s+$/.test(part)) return part;
    const clean = normalize(part);
    return <span key={i} onClick={() => choose(part, sentenceAt(text, start))}
      className={'word ' + (clean === selected ? 'active' : '')}>{part}</span>;
  });

  return <main>
    <header><div className="brand">📖 English → Armenian Reader</div><div className="subtitle">Read • Translate • Listen • Learn</div></header>
    <section className="toolbar" aria-label="Reading controls">
      <label className="upload">📁 {busy ? 'Processing…' : 'Upload a book'}<input type="file" accept=".pdf,.epub,.docx,.txt" onChange={upload} disabled={busy} /></label>
      <button type="button" className="secondary" onClick={() => { setPasteOpen(value => !value); setError(''); }}>
        {pasteOpen ? '✕ Close paste editor' : '📋 Paste a story'}
      </button>
      <label>Text size <input type="range" aria-label="Text size" min="15" max="32" value={size} onChange={e => setSize(+e.target.value)} /></label>
    </section>
    {pasteOpen && <section className="panel" aria-label="Paste a story" style={{ marginBottom: 16 }}>
      <h3>Paste an English story</h3>
      <p className="hint">Copy text from a website, email, or document, then paste it below. Opening it replaces the current reading text, but keeps your vocabulary.</p>
      <label htmlFor="paste-story-title" style={{ display: 'block', marginBottom: 6 }}>Story title (optional)</label>
      <input id="paste-story-title" type="text" value={pasteTitle} onChange={e => setPasteTitle(e.target.value)} placeholder="My English story"
        style={{ display: 'block', boxSizing: 'border-box', width: '100%', padding: 10, marginBottom: 12, border: '1px solid #d6dce6', borderRadius: 8 }} />
      <label htmlFor="paste-story-text" style={{ display: 'block', marginBottom: 6 }}>Story text</label>
      <textarea id="paste-story-text" value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="Paste your English story here..." rows={10}
        style={{ display: 'block', boxSizing: 'border-box', width: '100%', padding: 12, marginBottom: 12, border: '1px solid #d6dce6', borderRadius: 8, resize: 'vertical', font: 'inherit' }} />
      <button type="button" onClick={loadPastedStory}>📖 Open pasted story</button>
    </section>}
    {error && <p className="error">{error}</p>}
    <div className="layout">
      <section className="reader"><h2>{filename}</h2><p className="hint">Tap or click any English word</p><article aria-label="Book text" style={{ fontSize: size }}>{parts}</article></section>
      <aside>
        <section className={'panel translation-panel ' + (mobileWordOpen ? 'mobile-open' : '')}>
          <button type="button" className="mobile-close" aria-label="Close word translation" onClick={() => setMobileWordOpen(false)}>✕</button>
          <h3>Word translation</h3>
          {selected ? <>
            <h2>{selected}</h2>
            <div className="meaning" lang="hy">{definition?.[0] || 'Translating…'}</div>
            {definition && !definition[0].startsWith('Translation unavailable') && <button type="button" className="secondary" onClick={() => { setMeaningDraft(definition[0]); setEditMeaning(value => !value); }}>✏️ Correct Armenian meaning</button>}
            {editMeaning && <div style={{ marginTop: 10 }}>
              <input aria-label="Corrected Armenian meaning" lang="hy" value={meaningDraft} onChange={e => setMeaningDraft(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 10, marginBottom: 8 }} />
              <button type="button" onClick={saveCorrection} disabled={!meaningDraft.trim()}>Save correction</button>
            </div>}
            {translationNote && <p role="status" className="hint">{translationNote}</p>}
            <button onClick={speak}>🔊 Hear in American English</button>
            <p className="hint">Example in the book</p>
            <p>{example || 'Select a word in your book to see its sentence.'}</p>
            {example && example !== 'No sentence available for this saved word.' && <>
              <button type="button" className="secondary" onClick={translateSentence} disabled={sentenceBusy}>{sentenceBusy ? 'Translating sentence…' : '🌐 Translate entire sentence to Armenian'}</button>
              {sentenceTranslation && <p className="meaning" lang="hy" aria-label="Armenian sentence translation">{sentenceTranslation}</p>}
            </>}
            <button className="secondary" onClick={save} disabled={!definition || definition[0].startsWith('Translation unavailable')}>
              {saved.some(x => x.word === selected) ? '✓ Remove from vocabulary' : '＋ Save to vocabulary'}
            </button>
          </> : <p>Select a word in your book.</p>}
        </section>
        <section className="panel" aria-label="Vocabulary learning">
          <h3>Saved vocabulary ({saved.length})</h3>
          <p className="hint">{saved.filter(x => x.learned).length} learned · {reviewWords.length} to review</p>
          {learningMessage && <p role="status" style={{ color: '#187447', fontWeight: 600 }}>{learningMessage}</p>}
          <input aria-label="Search saved words" placeholder="Search English or Armenian..."
            value={vocabSearch} onChange={e => setVocabSearch(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #d6dce6', borderRadius: 8, marginBottom: 8 }} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
            <input type="checkbox" checked={reviewOnly} onChange={e => setReviewOnly(e.target.checked)} /> Show only words to review
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className="secondary" onClick={() => { setReviewMode(!reviewMode); setReviewIndex(0); setShowAnswer(false); }} disabled={!reviewWords.length}>
              {reviewMode ? 'Close review' : 'Review words'}
            </button>
            <button className="secondary" onClick={exportVocabulary} disabled={!saved.length}>Export CSV</button>
          </div>
          {reviewMode && !reviewWord && <p role="status">Great work! All saved words are marked as learned.</p>}
          {reviewMode && reviewWord && <div style={{ border: '1px solid #d6dce6', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <p className="hint">Flashcard {reviewIndex % reviewWords.length + 1} of {reviewWords.length}</p>
            <h2>{reviewWord.word}</h2>
            <button className="secondary" onClick={() => speakWord(reviewWord.word)}>🔊 Listen</button>
            {showAnswer ? <>
              <p lang="hy" className="meaning">{reviewWord.meaning}</p>
              <p>{reviewWord.example || 'No example saved.'}</p>
              <button onClick={markReviewLearned}>✓ Mark learned</button>
            </> : <button onClick={() => setShowAnswer(true)}>Show Armenian answer</button>}
            <button className="secondary" onClick={() => { setReviewIndex(i => i + 1); setShowAnswer(false); }}>Next word</button>
          </div>}
          {filteredWords.length ? filteredWords.map(x => <div key={x.word}
            style={{ borderBottom: '1px solid #eee', padding: '10px 0', overflowWrap: 'anywhere' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <button className="plain" onClick={() => choose(x.word, x.example || '')}>{x.word}</button>
              <button className="secondary" onClick={() => speakWord(x.word)} aria-label={'Pronounce ' + x.word}>🔊</button>
            </div>
            <div lang="hy">{x.meaning}</div>
            {x.example && <p className="hint">{x.example}</p>}
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
              <input type="checkbox" checked={Boolean(x.learned)} onChange={() => toggleLearned(x.word)} /> Learned
            </label>
          </div>) : <p className="hint">{saved.length ? 'No matching words.' : 'Your saved words will appear here.'}</p>}
        </section>
      </aside>
    </div>
    <footer>Prototype v0.6 · Free word and sentence translations may be inaccurate or rate-limited. Corrections and cached translations stay on this device. Scanned-book OCR is not yet supported.</footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
