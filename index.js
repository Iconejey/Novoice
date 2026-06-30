const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execSync } = require('child_process');

// 1. ENVIRONMENT VARIABLES LOADING
function loadEnv() {
	if (fs.existsSync('.env')) {
		const lines = fs.readFileSync('.env', 'utf8').split('\n');
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const index = trimmed.indexOf('=');
			if (index === -1) continue;
			const key = trimmed.slice(0, index).trim();
			const val = trimmed.slice(index + 1).trim();
			process.env[key] = val;
		}
	}
}
loadEnv();

const gemini_api_key = process.env.GEMINI_API_KEY;
const gemini_model = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

if (!gemini_api_key) {
	console.error('Error: GEMINI_API_KEY is not defined in .env');
	process.exit(1);
}

// 2. EVDEV KEYCODES PARSER & FALLBACKS
function loadKeyCodes() {
	const codes = {};
	const names = {};
	try {
		if (fs.existsSync('/usr/include/linux/input-event-codes.h')) {
			const content = fs.readFileSync('/usr/include/linux/input-event-codes.h', 'utf8');
			const regex = /#define\s+(KEY_[A-Z0-9_]+)\s+(0x[0-9a-fA-F]+|\d+)/g;
			let match;
			while ((match = regex.exec(content)) !== null) {
				const name = match[1];
				const val_str = match[2];
				const code = val_str.startsWith('0x') ? parseInt(val_str, 16) : parseInt(val_str, 10);
				codes[name] = code;
				names[code] = name;
			}
		}
	} catch (err) {
		console.warn('Could not read /usr/include/linux/input-event-codes.h, utilizing fallback defaults:', err.message);
	}

	// Standard essential fallbacks
	const fallbacks = {
		KEY_RESERVED: 0,
		KEY_ESC: 1,
		KEY_1: 2,
		KEY_2: 3,
		KEY_3: 4,
		KEY_4: 5,
		KEY_5: 6,
		KEY_6: 7,
		KEY_7: 8,
		KEY_8: 9,
		KEY_9: 10,
		KEY_0: 11,
		KEY_MINUS: 12,
		KEY_EQUAL: 13,
		KEY_BACKSPACE: 14,
		KEY_TAB: 15,
		KEY_Q: 16,
		KEY_W: 17,
		KEY_E: 18,
		KEY_R: 19,
		KEY_T: 20,
		KEY_Y: 21,
		KEY_U: 22,
		KEY_I: 23,
		KEY_O: 24,
		KEY_P: 25,
		KEY_LEFTBRACE: 26,
		KEY_RIGHTBRACE: 27,
		KEY_ENTER: 28,
		KEY_LEFTCTRL: 29,
		KEY_A: 30,
		KEY_S: 31,
		KEY_D: 32,
		KEY_F: 33,
		KEY_G: 34,
		KEY_H: 35,
		KEY_J: 36,
		KEY_K: 37,
		KEY_L: 38,
		KEY_SEMICOLON: 39,
		KEY_APOSTROPHE: 40,
		KEY_GRAVE: 41,
		KEY_LEFTSHIFT: 42,
		KEY_BACKSLASH: 43,
		KEY_Z: 44,
		KEY_X: 45,
		KEY_C: 46,
		KEY_V: 47,
		KEY_B: 48,
		KEY_N: 49,
		KEY_M: 50,
		KEY_COMMA: 51,
		KEY_DOT: 52,
		KEY_SLASH: 53,
		KEY_RIGHTSHIFT: 54,
		KEY_KPASTERISK: 55,
		KEY_LEFTALT: 56,
		KEY_SPACE: 57,
		KEY_CAPSLOCK: 58,
		KEY_F1: 59,
		KEY_F2: 60,
		KEY_F3: 61,
		KEY_F4: 62,
		KEY_F5: 63,
		KEY_F6: 64,
		KEY_F7: 65,
		KEY_F8: 66,
		KEY_F9: 67,
		KEY_F10: 68,
		KEY_NUMLOCK: 69,
		KEY_SCROLLLOCK: 70,
		KEY_KP7: 71,
		KEY_KP8: 72,
		KEY_KP9: 73,
		KEY_KPMINUS: 74,
		KEY_KP4: 75,
		KEY_KP5: 76,
		KEY_KP6: 77,
		KEY_KPPLUS: 78,
		KEY_KP1: 79,
		KEY_KP2: 80,
		KEY_KP3: 81,
		KEY_KP0: 82,
		KEY_KPDOT: 83,
		KEY_F11: 87,
		KEY_F12: 88,
		KEY_RIGHTCTRL: 97,
		KEY_RIGHTALT: 100,
		KEY_HOME: 102,
		KEY_UP: 103,
		KEY_PAGEUP: 104,
		KEY_LEFT: 105,
		KEY_RIGHT: 106,
		KEY_END: 107,
		KEY_DOWN: 108,
		KEY_PAGEDOWN: 109,
		KEY_INSERT: 110,
		KEY_DELETE: 111,
		KEY_LEFTMETA: 125,
		KEY_RIGHTMETA: 126,
		KEY_COMPOSE: 127
	};

	for (const [name, code] of Object.entries(fallbacks)) {
		if (!(name in codes)) {
			codes[name] = code;
			names[code] = name;
		}
	}

	return { codes, names };
}

const { codes, names } = loadKeyCodes();

function parseCombo(combo_str) {
	if (!combo_str) return null;
	const parts = combo_str
		.split('+')
		.map(k => k.trim().toUpperCase())
		.filter(k => k.length > 0);
	if (parts.length === 0) return null;
	const key_codes = [];
	for (const part of parts) {
		const code = codes[part];
		if (code === undefined) {
			console.warn(`Warning: Key name "${part}" is not recognized.`);
			return null;
		}
		key_codes.push(code);
	}
	return key_codes;
}

const raw_hold_key = (process.env.HOLD_KEY || '').trim();
const raw_toggle_keys = (process.env.TOGGLE_KEYS || '').trim();

const hold_combo = parseCombo(raw_hold_key);
const toggle_combos = raw_toggle_keys
	.split(',')
	.map(s => s.trim())
	.filter(s => s.length > 0)
	.map(s => parseCombo(s))
	.filter(combo => combo !== null);

if (!hold_combo && toggle_combos.length === 0) {
	console.error('Error: No valid keys or combinations are configured. Please check HOLD_KEY or TOGGLE_KEYS in .env');
	process.exit(1);
}

console.log('--- Novoice Configuration ---');
console.log('Gemini Model:', gemini_model);
console.log('Hold Combo:', hold_combo ? `${raw_hold_key} (codes: ${hold_combo.join('+')})` : 'None');
console.log(
	'Toggle Combos:',
	toggle_combos.length > 0
		? toggle_combos
				.map(combo => {
					const names_str = combo.map(c => names[c]).join('+');
					return `${names_str} (codes: ${combo.join('+')})`;
				})
				.join(', ')
		: 'None'
);
console.log('-----------------------------');

// 3. HYPRLAND UI CONTROL (ACTIVE BORDER DECORATOR)
let default_border_color = '0xff82aaff 0xff3b8eea 45deg'; // Vibrant cyan-magenta gradient fallback

function formatHyprlandColor(raw_color) {
	if (!raw_color) return raw_color;
	return raw_color
		.split(/\s+/)
		.map(word => {
			if (/^[0-9a-fA-F]{8}$/.test(word)) {
				return '0x' + word.toLowerCase();
			}
			if (/^[0-9a-fA-F]{6}$/.test(word)) {
				return '0xff' + word.toLowerCase();
			}
			return word;
		})
		.join(' ');
}

function retrieveDefaultBorderColor() {
	try {
		const output = execSync('hyprctl getoption general:col.active_border -j', {
			encoding: 'utf8'
		});
		const data = JSON.parse(output);
		const raw = data.custom || data.str || data.val;
		if (raw) {
			default_border_color = formatHyprlandColor(raw);
		}
	} catch (err) {
		console.warn('Could not query current Hyprland active border:', err.message);
	}
}
retrieveDefaultBorderColor();
console.log('Default Hyprland active border color:', default_border_color);

function setBorderColor(color) {
	try {
		execSync(`hyprctl keyword general:col.active_border "${color}"`, {
			stdio: 'ignore'
		});
	} catch (err) {
		console.error(`Failed to set Hyprland border color to ${color}:`, err.message);
	}
}

function restoreDefaultBorder() {
	setBorderColor(default_border_color);
}

function getActiveWindowContext() {
	try {
		const output = execSync('hyprctl activewindow -j', { encoding: 'utf8' });
		const data = JSON.parse(output);
		return {
			class: data.class || 'unknown',
			title: data.title || 'unknown'
		};
	} catch (e) {
		return { class: 'unknown', title: 'unknown' };
	}
}

// 4. AUDIO PROCESSING (RECORDING AND SILENCE TRIMMING)
const raw_audio_path = '/tmp/novoice_raw.wav';
const trimmed_audio_path = '/tmp/novoice_trimmed.wav';

let is_recording = false;
let is_processing = false;
let active_trigger_type = null; // 'hold' or 'toggle'
let active_trigger_key = null; // numeric code
let ffmpeg_process = null;

function trimSilence() {
	return new Promise((resolve, reject) => {
		// Trims silence below -40dB from start and end of recording
		const proc = spawn('ffmpeg', ['-y', '-i', raw_audio_path, '-af', 'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-40dB:stop_periods=1:stop_duration=0.1:stop_threshold=-40dB', trimmed_audio_path]);

		proc.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ffmpeg silenceremove exited with code ${code}`));
			}
		});

		proc.on('error', err => {
			reject(err);
		});
	});
}

// 5. GEMINI API & YDOTOOL TYPING INTEGRATION
function sendToGemini(api_key, model, audio_base64, window_class, window_title) {
	return new Promise((resolve, reject) => {
		const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${api_key}`;

		let prompt = `You are an AI-powered voice typing helper. Your absolute mandate is to transcribe the spoken voice in the provided audio.
Instructions:
- Transcribe exactly what is spoken in the audio.
- Do NOT add any conversational filler, meta-comments, greeting, or descriptions of your own. Output ONLY the clean, final transcribed text.
- Correct minor grammar mistakes, and add appropriate punctuation and capitalization.
- Remove minor filler words (like 'um', 'uh', 'like', 'you know') and repetitions or stutters unless they are clearly intentional.`;

		const spoken_lang = process.env.LANGUAGE;
		if (spoken_lang) prompt += `\n- Spoken Language: The speech is spoken in "${spoken_lang}". Please transcribe accurately in "${spoken_lang}".`;

		prompt += `\n- Context: The user is typing inside an active window with class '${window_class}' and title '${window_title}'. Format/capitalize code tokens, acronyms, or proper names accordingly if appropriate.`;

		const payload = JSON.stringify({
			contents: [
				{
					parts: [
						{ text: prompt },
						{
							inlineData: {
								mimeType: 'audio/wav',
								data: audio_base64
							}
						}
					]
				}
			]
		});

		const parsed_url = new URL(url);
		const options = {
			hostname: parsed_url.hostname,
			port: 443,
			path: parsed_url.pathname + parsed_url.search,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Content-Length': Buffer.byteLength(payload)
			}
		};

		const req = https.request(options, res => {
			let data = '';
			res.on('data', chunk => {
				data += chunk;
			});
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) {
					try {
						const parsed = JSON.parse(data);
						const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
						if (text !== undefined) {
							resolve(text.trim());
						} else {
							reject(new Error('Unexpected response structure from Gemini API: ' + data));
						}
					} catch (e) {
						reject(new Error('Failed to parse Gemini response JSON: ' + e.message));
					}
				} else {
					reject(new Error(`Gemini API returned HTTP status ${res.statusCode}: ${data}`));
				}
			});
		});

		req.on('error', e => {
			reject(e);
		});

		req.write(payload);
		req.end();
	});
}

// KEYBOARD LAYOUT TRANSLATION FOR NON-QWERTY SYSTEMS
function getLayoutMap(layout) {
	if (!layout) return null;
	const norm = layout.toLowerCase();
	if (norm === 'fr' || norm === 'azerty') {
		return {
			a: 'q',
			q: 'a',
			z: 'w',
			w: 'z',
			m: ';',
			',': 'm',
			';': ',',
			':': '.',
			'!': '/',
			ù: "'",
			A: 'Q',
			Q: 'A',
			Z: 'W',
			W: 'Z',
			M: ':',
			'?': 'M',
			'.': '<',
			'/': '>',
			'§': '?',
			'&': '1',
			é: '2',
			'"': '3',
			"'": '4',
			'(': '5',
			'-': '6',
			è: '7',
			_: '8',
			ç: '9',
			à: '0',
			')': '-',
			'=': '=',
			1: '!',
			2: '@',
			3: '#',
			4: '$',
			5: '%',
			6: '^',
			7: '&',
			8: '*',
			9: '(',
			0: ')',
			'°': '_',
			'+': '+',
			// Dead keys circumflex
			â: '[a',
			ê: '[e',
			î: '[i',
			ô: '[o',
			û: '[u',
			Â: '[A',
			Ê: '[E',
			Î: '[I',
			Ô: '[O',
			Û: '[U',
			// Dead keys diaeresis
			ä: '{a',
			ë: '{e',
			ï: '{i',
			ö: '{o',
			ü: '{u',
			Ä: '{A',
			Ë: '{E',
			Ï: '{I',
			Ö: '{O',
			Ü: '{U'
		};
	}
	if (norm === 'de' || norm === 'qwertz') {
		return {
			z: 'y',
			y: 'z',
			Z: 'Y',
			Y: 'Z',
			ä: ';',
			Ä: ':',
			ö: "'",
			Ö: '"',
			ü: '[',
			Ü: '{',
			ß: '-',
			'-': '/',
			_: '?',
			'/': '_',
			'?': 'I'
		};
	}
	return null;
}

function translateToLayout(text, layout) {
	const map = getLayoutMap(layout);
	if (!map) return text;
	let result = '';
	for (const char of text) {
		if (char in map) {
			result += map[char];
		} else {
			result += char;
		}
	}
	return result;
}

function typeText(text) {
	return new Promise((resolve, reject) => {
		const layout = process.env.KEYBOARD_LAYOUT;
		const translated = translateToLayout(text, layout);

		// We stream the text straight to ydotool's stdin to eliminate shell escape security vulnerabilities or length limitations.
		const proc = spawn('ydotool', ['type', '-d', '1', '-H', '1', '-f', '-']);
		proc.stdin.write(translated);
		proc.stdin.end();

		proc.on('close', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`ydotool type exited with code ${code}`));
			}
		});

		proc.on('error', err => {
			reject(err);
		});
	});
}

async function handleError(error) {
	console.error('Error in speech-to-text pipeline:', error);
	try {
		// Change border to red
		setBorderColor('0xffff0000');

		// Type out the error in the active window
		const error_text = `Error: ${error.message || error}`;
		await typeText(error_text);

		// Wait for 1 second in the red state
		await new Promise(r => setTimeout(r, 1000));
	} catch (e) {
		console.error('Failed to log error to desktop window:', e.message);
	} finally {
		restoreDefaultBorder();
	}
}

// 6. PIPELINE RECORDING STATE TRANSITIONS
function startRecording(trigger_type, trigger_key) {
	if (is_recording || is_processing) return;
	is_recording = true;
	active_trigger_type = trigger_type;
	active_trigger_key = trigger_key;

	console.log(`\n=== Recording Started (${trigger_type} via ${names[trigger_key] || trigger_key}) ===`);

	// Set border to Green
	setBorderColor('0xff00ff00');

	// Remove stale audio files
	try {
		if (fs.existsSync(raw_audio_path)) fs.unlinkSync(raw_audio_path);
		if (fs.existsSync(trimmed_audio_path)) fs.unlinkSync(trimmed_audio_path);
	} catch (e) {}

	// Spawn ffmpeg to record audio from PulseAudio default source
	ffmpeg_process = spawn('ffmpeg', ['-y', '-f', 'pulse', '-i', 'default', '-ar', '16000', '-ac', '1', raw_audio_path]);

	ffmpeg_process.on('error', err => {
		console.error('Failed to start ffmpeg recorder:', err);
		is_recording = false;
		handleError(new Error('Failed to start ffmpeg recording process.'));
	});

	ffmpeg_process.on('close', async code => {
		console.log(`Recording ffmpeg process stopped. Code: ${code}`);
		ffmpeg_process = null;
		is_processing = true;

		try {
			// Set border to Purple while processing
			setBorderColor('0xffd142f5');

			console.log('Trimming silence...');
			await trimSilence();

			if (!fs.existsSync(trimmed_audio_path)) {
				throw new Error('Trimmed audio file was not generated.');
			}

			const stats = fs.statSync(trimmed_audio_path);
			// At 16kHz 16-bit Mono, 1.0 second of raw PCM data is exactly 32,000 bytes.
			// If trimmed audio is 32000 bytes or less, it's under 1.0 second of spoken audio.
			if (stats.size <= 32000) {
				console.log('Trimmed audio is under 1.0 second. Ignoring.');
				restoreDefaultBorder();
				return;
			}

			const window_context = getActiveWindowContext();
			console.log(`Active window class: "${window_context.class}", title: "${window_context.title}"`);

			console.log('Base64 encoding audio...');
			const audio_base64 = fs.readFileSync(trimmed_audio_path, {
				encoding: 'base64'
			});

			console.log('Sending request to Google Gemini API...');
			const text = await sendToGemini(gemini_api_key, gemini_model, audio_base64, window_context.class, window_context.title);

			console.log(`Received transcription: "${text}"`);
			if (text && text.trim().length > 0) {
				console.log('Typing transcription into active window...');
				await typeText(text);
			} else {
				console.log('No spoken text detected by Gemini.');
			}

			// Restore default border color
			restoreDefaultBorder();
		} catch (err) {
			await handleError(err);
		} finally {
			is_processing = false;
			console.log('=== Speech-to-Text Pipeline Idle ===\n');
		}
	});
}

function stopRecording() {
	if (!is_recording) return;
	is_recording = false;
	console.log('Stopping recording...');
	if (ffmpeg_process) {
		// Send SIGINT to allow ffmpeg to gracefully close and write standard WAV headers
		ffmpeg_process.kill('SIGINT');
	}
}

const held_keys = new Set();

// 7. KEYBOARD EVENT ROUTER
function handleKeyEvent(code, value) {
	// Ignore key repeats (value === 2)
	if (value === 2) return;

	if (value === 1) {
		// Key Press
		let toggle_matched = false;
		for (const combo of toggle_combos) {
			if (combo.includes(code)) {
				const other_keys_held = combo.every(c => c === code || held_keys.has(c));
				if (other_keys_held) {
					toggle_matched = true;
					break;
				}
			}
		}

		held_keys.add(code);

		if (is_processing) {
			// Reject start inputs during transcription/trimming
			return;
		}

		if (toggle_matched) {
			if (!is_recording) {
				startRecording('toggle', code);
			} else {
				stopRecording();
			}
		} else if (hold_combo && hold_combo.includes(code)) {
			const other_keys_held = hold_combo.every(c => c === code || held_keys.has(c));
			if (other_keys_held) {
				if (!is_recording) {
					startRecording('hold', code);
				}
			}
		}
	} else if (value === 0) {
		// Key Release
		held_keys.delete(code);

		if (is_recording && active_trigger_type === 'hold') {
			if (hold_combo && hold_combo.includes(code)) {
				stopRecording();
			}
		}
	}
}

// 8. EVDEV DEVICE LISTENERS (RAW KEYBOARD STREAMS)
function findUniqueKeyboards() {
	const unique_paths = new Set();
	const dirs = ['/dev/input/by-path', '/dev/input/by-id'];
	for (const dir of dirs) {
		if (fs.existsSync(dir)) {
			const files = fs.readdirSync(dir);
			for (const file of files) {
				if (file.endsWith('-event-kbd')) {
					try {
						const full_path = path.join(dir, file);
						const real_path = fs.realpathSync(full_path);
						unique_paths.add(real_path);
					} catch (e) {
						// ignore
					}
				}
			}
		}
	}
	return Array.from(unique_paths);
}

const keyboard_devices = findUniqueKeyboards();
if (keyboard_devices.length === 0) {
	console.error('Error: No keyboard event devices found under /dev/input/');
	console.error('Please make sure you have read permissions to /dev/input/ (e.g. part of "input" group).');
	process.exit(1);
}

const active_streams = [];

console.log('Listening for global keyboard events on:');
for (const dev of keyboard_devices) {
	console.log(` - ${dev}`);

	let remainder = Buffer.alloc(0);
	const stream = fs.createReadStream(dev);
	active_streams.push(stream);

	stream.on('data', chunk => {
		remainder = Buffer.concat([remainder, chunk]);
		while (remainder.length >= 24) {
			const event_buf = remainder.subarray(0, 24);
			remainder = remainder.subarray(24);

			// Parse 24-byte Linux input_event struct:
			// - tv_sec (8 bytes)
			// - tv_usec (8 bytes)
			// - type (2 bytes)
			// - code (2 bytes)
			// - value (4 bytes)
			const type = event_buf.readUInt16LE(16);
			const code = event_buf.readUInt16LE(18);
			const value = event_buf.readInt32LE(20);

			// EV_KEY type is 1
			if (type === 1) {
				handleKeyEvent(code, value);
			}
		}
	});

	stream.on('error', err => {
		console.error(`Error streaming from device ${dev}:`, err.message);
	});
}

// 9. SIGNAL CLEANUP HOOKS
function cleanupAndExit() {
	console.log('\nRestoring default Hyprland borders and exiting cleanly...');

	// Set safety timeout to force exit if stuck
	setTimeout(() => {
		process.kill(process.pid, 'SIGKILL');
	}, 500);

	try {
		for (const stream of active_streams) {
			stream.destroy();
		}
		if (ffmpeg_process) {
			ffmpeg_process.kill('SIGKILL');
		}
		restoreDefaultBorder();
	} catch (e) {}
	process.kill(process.pid, 'SIGKILL');
}

process.on('SIGINT', () => {
	if (ffmpeg_process) {
		try {
			ffmpeg_process.kill('SIGKILL');
		} catch (e) {}
	}
	process.kill(process.pid, 'SIGKILL');
});
process.on('SIGTERM', cleanupAndExit);

console.log('\n=== Novoice is running in Workspace Developer Mode ===');
console.log('Press Hold Key or Toggle Key to record. Press Ctrl+C to terminate.');
