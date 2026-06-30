# Novoice

Novoice is an AI-Powered speech-to-text program that types what you say while you hold down a key or toggle it (hold key and toggle key are configurable in the .env file). It is especially designed for Arch Linux with Hyprland.

## Process

1. A Node.js program waits for user to press and maintain the hold key or toggle the toggle key to start recording audio from the microphone.
2. When the user releases the hold key or presses the hold key or toggle key after toggling, the program stops recording.
3. The audio is trimmed to remove silence.
4. Some context is gathered from the active window.
5. If the trimmed audio is longer than 1 second, it is sent to the Gemini API for transcription with instructions to add punctuation and capitalization and to remove unnecessary filler words or stutters.
6. The resulting text is then typed out in the active window using the keyboard.

When the recording starts, the acive window border (hyprland config) changes to green. When the recording stops, it changes to purple. When the result is typed out, it changes back to default.

If an error occurs, the border changes to red for 1 second and the error is typed out in the active window.

## Configuration (.env)

You can configure several options in your `.env` file:

- `GEMINI_API_KEY`: Your Google Gemini API Key.
- `GEMINI_MODEL`: The model to use (default: `gemini-3.5-flash`).
- `HOLD_KEY`: Key to press and hold to record (e.g., `KEY_RIGHTALT`).
- `TOGGLE_KEYS`: Key combinations to toggle recording (e.g., `KEY_LEFTCTRL+KEY_RIGHTALT`).
- `TRANSLATE_HOLD_KEY`: Key combination to press and hold to record and translate the spoken audio into English (e.g., `KEY_LEFTSHIFT+KEY_LEFTALT`).
- `TRANSLATE_TOGGLE_KEYS`: Key combinations to toggle recording start/stop and translate the spoken audio into English (e.g., `KEY_LEFTSHIFT+KEY_LEFTCTRL+KEY_LEFTALT`).
- `KEYBOARD_LAYOUT`: Set to your keyboard layout (e.g., `fr` or `azerty` for French layout, `de` or `qwertz` for German, or leave blank/`us` for standard US QWERTY).
- `LANGUAGE`: The expected spoken language (e.g., `French`, `German`, `English`) to improve transcription accuracy.
