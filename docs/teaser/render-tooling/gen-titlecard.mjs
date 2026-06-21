// Generates a standalone single-word TITLE CARD: the signature BeakerBot "pulse"
// morph ball (exact keyframes from BeakerBotThinking.module.css) beside the
// feature word, which types on character by character. Pure static HTML/CSS so
// the frame-stepped renderer can step it.
//   node gen-titlecard.mjs "Data Hub" ../scenes/title-data-hub.html
import { writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';

const word = process.argv[2];
const outArg = process.argv[3];
if (!word || !outArg) { console.error('Usage: node gen-titlecard.mjs "Word" <outPath>'); process.exit(1); }
const out = isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg);

const TYPE_START = 0.5;     // blob "thinks" briefly, then the word types on
const PER_CHAR = 0.05;      // seconds between characters

const chars = [...word].map((c, i) => {
  const ch = c === ' ' ? '&nbsp;' : c;
  const delay = (TYPE_START + i * PER_CHAR).toFixed(3);
  return `<span class="ch" style="animation-delay:${delay}s">${ch}</span>`;
}).join('');
const caretDelay = (TYPE_START + word.length * PER_CHAR + 0.02).toFixed(3);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Title: ${word}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{height:100%}
  body{background:#eef2f9;color:#15243b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;overflow:hidden}
  .group{display:flex;align-items:center;gap:26px;opacity:0;animation:groupin .5s cubic-bezier(.2,.8,.2,1) .05s forwards}

  /* Signature BeakerBot morph ball (pulse variant, exact keyframes) */
  .blob{width:58px;height:58px;background:#1aa0e6;border-radius:48% 52% 50% 50% / 52% 48% 52% 48%;
    box-shadow:0 8px 24px rgba(26,160,230,.30);animation:bbPulse 2.4s ease-in-out infinite}

  .word{display:inline-flex;align-items:baseline;font-size:70px;font-weight:700;letter-spacing:-.015em;line-height:1}
  .ch{display:inline-block;opacity:0;transform:translateY(7px);animation:chin .2s ease forwards;color:#15243b}
  .caret{display:inline-block;width:5px;height:58px;margin-left:6px;border-radius:2px;background:#1283c9;opacity:0;
    animation:caretin .12s ease ${caretDelay}s forwards, blink .9s step-end ${caretDelay}s infinite}

  @keyframes bbPulse{
    0%,100%{border-radius:48% 52% 50% 50% / 52% 48% 52% 48%;transform:scale(.62) rotate(0deg);opacity:.55}
    33%{border-radius:62% 38% 55% 45% / 60% 52% 48% 40%;transform:scale(.95) rotate(45deg);opacity:1}
    66%{border-radius:40% 60% 45% 55% / 45% 55% 45% 55%;transform:scale(.82) rotate(-35deg);opacity:.85}
  }
  @keyframes groupin{to{opacity:1}}
  @keyframes chin{to{opacity:1;transform:none}}
  @keyframes caretin{to{opacity:1}}
  @keyframes blink{50%{opacity:0}}
</style>
</head>
<body>
  <div class="group">
    <div class="blob"></div>
    <div class="word">${chars}<span class="caret"></span></div>
  </div>
</body>
</html>
`;

writeFileSync(out, html);
console.log('Wrote', out);
