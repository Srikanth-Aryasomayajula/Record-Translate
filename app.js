let mediaRecorder, audioStream, screenStream, combinedStream;
let chunks = [];
let recognition;
let transcription = [], translation = [];
let langDetected = '';
let recLang = 'de-DE'; // start with German as default
let recording = false;

// Init DOM
const recordBtn = document.getElementById('recordBtn');
const stopBtn = document.getElementById('stopBtn');
const status = document.getElementById('status');
const preview = document.getElementById('preview');
const subtitles = document.getElementById('subtitles');
const translations = document.getElementById('translations');
const downloadLink = document.getElementById('downloadLink');

// Returns the best language code for recognition based on given phrase (heuristic)
function guessLang(text) {
  const de = /[äöüß]|(wie|und|ich|nicht|dass|sie|er|wir|haben|kann|mit|für|auf|bei|daß)\b/i;
  return de.test(text) ? 'de-DE' : 'en-US';
}

// Start Recording
recordBtn.onclick = async function() {
  try {
    // Get screen and audio streams
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Merge streams (if system audio isn't captured, at least mic is)
    const mergedTracks = [
      ...screenStream.getVideoTracks(),
      // Prefer screen's audio, else mic
      ...(screenStream.getAudioTracks().length ? screenStream.getAudioTracks() : audioStream.getAudioTracks())
    ];
    combinedStream = new MediaStream(mergedTracks);

    chunks = [];
    transcription = [];
    translation = [];
    langDetected = '';
    subtitles.textContent = '';
    translations.textContent = '';
    downloadLink.style.display = "none";
    status.textContent = 'Recording...';

    // Init MediaRecorder
    mediaRecorder = new MediaRecorder(combinedStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = showRecording;
    mediaRecorder.start();

    // Start Speech Recognition (auto lang)
    initRecognition();

    recordBtn.disabled = true;
    stopBtn.disabled = false;
    recording = true;
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  }
};

// Stop Recording
stopBtn.onclick = function() {
  if (mediaRecorder) mediaRecorder.stop();
  if (recognition) recognition.stop();
  if (screenStream) screenStream.getTracks().forEach(t => t.stop());
  if (audioStream) audioStream.getTracks().forEach(t => t.stop());
  status.textContent = 'Processing...';
  recordBtn.disabled = false;
  stopBtn.disabled = true;
  recording = false;
};

// Show Recorded Video
function showRecording() {
  let blob = new Blob(chunks, { type: "video/webm" });
  let url = URL.createObjectURL(blob);
  preview.src = url;
  downloadLink.href = url;
  downloadLink.style.display = "block";
  status.textContent = 'Done. You can download your recording below!';
}

// Initialize Speech Recognition
function initRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    status.textContent = "SpeechRecognition not supported in this browser.";
    return;
  }
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = recLang; // Start with German as default

  recognition.onresult = async function(event) {
    // Build one interim string per event to avoid overwrites
    let interimText = '';
  
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const res = event.results[i];
      const txt = res[0].transcript.trim();
  
      if (res.isFinal) {
        // 1) Persist final German text
        transcription.push(txt);
  
        // 2) Translate this final segment DE -> EN immediately
        //    Append a placeholder first so UI updates even if translation is slow
        translation.push('…');
        const thisIndex = translation.length - 1;
  
        try {
          const translated = await translateText(txt, 'de', 'en');
          translation[thisIndex] = translated || '[No translation]';
        } catch (e) {
          translation[thisIndex] = '[Translation error]';
        }
      } else {
        // Accumulate interim text for display only (not persisted)
        interimText += txt + ' ';
      }
    }
  
    // Update UI exactly once per event:
    // - Subtitles: all final lines + current interim preview
    const finals = transcription.join('\n');
    subtitles.textContent = interimText
      ? finals + '\n' + interimText.trim()
      : finals;
  
    // - Translations: only finalized translated lines (same count as transcription)
    translations.textContent = translation.join('\n');
  };

  recognition.onerror = function(ev) {
    status.textContent = 'Speech recognition error: ' + ev.error;
  };

  recognition.onend = function() {
    if (recording) recognition.start();
  };

  recognition.start();
}

// LibreTranslate API for translation (de→en)
async function translateText(text, from, to) {
  if (text.trim().length < 1) return '';
  try {
    const resp = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      // Use plain JSON per docs; change endpoint to libretranslate.de if .com rate-limits
      body: JSON.stringify({ q: text, source: from, target: to, format: 'text' })
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('Translate HTTP error', resp.status, body);
      return '[Translation failed]';
    }

    const data = await resp.json();
    // Some deployments return { translatedText }, others nest differently; guard it
    return (data && data.translatedText) ? data.translatedText : '[No translation]';
  } catch (e) {
    console.error('Translate fetch error', e);
    return '[Translation error]';
  }
}
