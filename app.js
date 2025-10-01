let mediaRecorder, audioStream, screenStream, combinedStream;
let chunks = [];
let recognition;
let transcription = [], translation = [];
let langDetected = '';
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
  recognition.lang = 'en-US'; // Start with English as default

  recognition.onresult = async function(event) {
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const res = event.results[i];
      let txt = res[0].transcript.trim();
      // Detect language if enough text
      if (!langDetected && txt.length > 6) {
        langDetected = guessLang(txt);
        recognition.lang = langDetected;
      }
      if (res.isFinal) {
        transcription.push(txt);
        subtitles.textContent += txt + '\n';
        // Translate non-English to English
        let toTranslate = langDetected == 'en-US' ? false : true;
        if (toTranslate) {
          const translated = await translateText(txt, 'de', 'en');
          translations.textContent += translated + '\n';
          translation.push(translated);
        } else {
          translations.textContent += txt + '\n'; // Already English
          translation.push(txt);
        }
      }
    }
    // For real-time effect, update transcript
    if (event.results[event.results.length - 1]) {
      const interim = event.results[event.results.length - 1][0].transcript;
      subtitles.textContent = transcription.join('\n') + '\n' + interim;
    }
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
    let resp = await fetch('https://libretranslate.com/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: text, source: from, target: to, format: "text" })
    });
    let data = await resp.json();
    return data.translatedText;
  } catch (e) {
    return '[Translation error]';
  }
}
