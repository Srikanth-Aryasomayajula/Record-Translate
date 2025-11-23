let mediaRecorder, audioStream, screenStream, combinedStream;
let chunks = [];
let recognition;
let transcription = [], translation = [];
let langDetected = '';
let recLang = 'de-DE'; // start with German as default
let recording = false;
let lastAudioAt = Date.now();
const SIXTY_MIN = 60 * 60 * 1000; // 60 minutes in ms
let recActive = false; // guards duplicate starts

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
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { systemAudio: "include" }
    });
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Merge streams (if system audio isn't captured, at least mic is)
    const mergedTracks = [
      ...screenStream.getVideoTracks(),
      ...screenStream.getAudioTracks(),   // system audio
      ...audioStream.getAudioTracks()     // microphone audio
    ];
    combinedStream = new MediaStream(mergedTracks);
    audioStream.getAudioTracks().forEach(t =>
      t.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
    );
    combinedStream.getAudioTracks().forEach(t => t.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }));

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

  // Generate filename: DD-MM-YYYY_HH-MM-SS.webm
  let now = new Date();
  let pad = n => n.toString().padStart(2, '0');
  let filename = 
    `${pad(now.getDate())}-${pad(now.getMonth()+1)}-${now.getFullYear()}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.webm`;

  downloadLink.download = filename;
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
    lastAudioAt = Date.now();
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
    const silentFor = Date.now() - lastAudioAt;
    if (silentFor >= SIXTY_MIN) {
      status.textContent = 'Speech recognition error: ' + ev.error;
    } else {
      // Suppress visible errors before 60 min; attempt silent restart
      if (recording) {
        try { recognition.stop(); } catch {}
      }
    }
  };

  recognition.onend = function() {
    if (recording) recognition.start();
  };

  recognition.start();
}

// LibreTranslate API for translation (de→en)
async function translateText(text, from = 'auto', to = 'en') {
  if (!text || !text.trim()) return '';
  try {
    const resp = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: from,      // 'auto' or 'de'
        target: to,        // 'en'
        format: 'text',
        alternatives: 1,   // optional; set to 3 if you want more
        api_key: ''        // optional; required on some instances
      })
    });

    if (!resp.ok) {
      console.error('Translate HTTP error', resp.status, await resp.text().catch(() => ''));
      return '[Translation failed]';
    }
    const data = await resp.json();
    return (data && data.translatedText) ? data.translatedText : '[No translation]';
  } catch (e) {
    console.error('Translate fetch error', e);
    return '[Translation error]';
  }
}








