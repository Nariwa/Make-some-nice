(() => {
    "use strict";
    if (window.synthesizer) return;

    if (window.backgroundMusic) window.backgroundMusic.muted = true;

    const beat = 60 / 108;
    const parts = [
        {
            notes: [
                69, 72, 76, 72, 69, 64, 67, 64,
                69, 72, 77, 72, 69, 65, 64, 65,
                67, 72, 76, 79, 76, 72, 67, 64,
                67, 71, 74, 71, 69, 67, 62, 67
            ],
            gate: beat,
            volume: 0.16
        },
        {
            notes: [45, 45, 52, 45, 41, 41, 48, 41, 48, 48, 43, 48, 43, 43, 50, 43],
            gate: beat * 0.9,
            volume: 0.22
        }
    ];
    const channels = new Map();
    const clamp = (value) => Math.max(0, Math.min(1, value));
    let context, master, impulse, ready;
    let volume = 0.55;

    function change(param, value) {
        param.setTargetAtTime(value, context.currentTime, 0.02);
    }

    function makeEffect(input, effectInput, effectOutput = effectInput) {
        const dry = context.createGain();
        const wet = context.createGain();
        const output = context.createGain();
        wet.gain.value = 0;
        input.connect(dry).connect(output);
        input.connect(effectInput);
        effectOutput.connect(wet).connect(output);
        return { dry, wet, output };
    }

    function setEffect(effect, amount) {
        const wet = clamp(amount);
        change(effect.dry.gain, 1 - wet);
        change(effect.wet.gain, wet);
    }

    function makeChorus(input) {
        const send = context.createGain();
        const output = context.createGain();
        output.gain.value = 0.7;

        [-0.8, 0.8].forEach((pan, i) => {
            const delay = context.createDelay(0.1);
            const panner = context.createStereoPanner();
            const wobble = context.createOscillator();
            const width = context.createGain();
            delay.delayTime.value = 0.015 + i * 0.008;
            panner.pan.value = pan;
            wobble.frequency.value = 0.8 + i * 0.3;
            width.gain.value = 0.006;
            send.connect(delay).connect(panner).connect(output);
            wobble.connect(width).connect(delay.delayTime);
            wobble.start();
        });
        return makeEffect(input, send, output);
    }

    function makeDelay(input) {
        const left = context.createDelay(1);
        const right = context.createDelay(1);
        const leftPan = context.createStereoPanner();
        const rightPan = context.createStereoPanner();
        const feedback = context.createGain();
        const output = context.createGain();
        left.delayTime.value = right.delayTime.value = beat * 0.75;
        leftPan.pan.value = -1;
        rightPan.pan.value = 1;
        feedback.gain.value = 0.55;
        left.connect(leftPan).connect(output);
        left.connect(right).connect(rightPan).connect(output);
        right.connect(feedback).connect(left);
        return makeEffect(input, left, output);
    }

    function makeImpulse() {
        const buffer = context.createBuffer(2, Math.round(context.sampleRate * 3.5), context.sampleRate);
        for (let channel = 0; channel < 2; channel++) {
            const samples = buffer.getChannelData(channel);
            for (let i = 0; i < samples.length; i++) {
                samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length) ** 2;
            }
        }
        return buffer;
    }

    function makeChannel(panel, part) {
        const input = context.createGain();
        const chorus = makeChorus(input);
        const delay = makeDelay(chorus.output);
        const room = context.createConvolver();
        room.buffer = impulse;
        const reverb = makeEffect(delay.output, room);
        reverb.output.connect(master);
        const channel = { panel, part, input, chorus, delay, reverb, version: 0 };
        panel.querySelectorAll(".effect input").forEach((control, i) => {
            setEffect(channel[["chorus", "delay", "reverb"][i]], knobValue(control));
        });
        return channel;
    }

    function envelope(param, time, gate, settings, peak) {
        const [attack, decay, sustain, release] = settings;
        let level = Math.min(1, gate / attack);
        param.setValueAtTime(0, time);
        param.linearRampToValueAtTime(level * peak, time + Math.min(attack, gate));

        if (gate > attack) {
            const end = Math.min(attack + decay, gate);
            level = 1 - (1 - sustain) * (end - attack) / decay;
            param.linearRampToValueAtTime(level * peak, time + end);
            if (gate > attack + decay) param.setValueAtTime(level * peak, time + gate);
        }
        param.linearRampToValueAtTime(0, time + gate + release);
    }

    async function renderPart(channel) {
        const version = ++channel.version;
        const controls = [...channel.panel.querySelectorAll(".envelope input")];
        const settings = [
            Math.max(0.005, Number(controls[0].value)),
            Math.max(0.005, Number(controls[1].value)),
            clamp(Number(controls[2].value) / 100),
            Math.max(0.005, Number(controls[3].value))
        ];
        const selected = channel.panel.querySelector("[data-wave].active")?.dataset.wave || "sine";
        const type = selected === "pulse" ? "square" : selected;
        const frames = Math.round(beat * 16 * context.sampleRate);
        const duration = frames / context.sampleRate;
        const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offline = new OfflineContext(1, frames * 2, context.sampleRate);

        for (let cycle = 0; cycle < 2; cycle++) {
            channel.part.notes.forEach((note, i) => {
                const time = duration * (cycle + i / channel.part.notes.length);
                const oscillator = offline.createOscillator();
                const gain = offline.createGain();
                oscillator.type = type;
                oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
                gain.gain.value = 0;
                envelope(gain.gain, time, channel.part.gate, settings, channel.part.volume);
                oscillator.connect(gain).connect(offline.destination);
                oscillator.start(time);
                oscillator.stop(time + channel.part.gate + settings[3]);
            });
        }

        const rendered = await offline.startRendering();
        if (version !== channel.version) return;
        const buffer = context.createBuffer(1, frames, context.sampleRate);
        buffer.getChannelData(0).set(rendered.getChannelData(0).subarray(frames));

        const source = context.createBufferSource();
        const fade = context.createGain();
        const now = context.currentTime;
        source.buffer = buffer;
        source.loop = true;
        fade.gain.value = 0;
        source.connect(fade).connect(channel.input);
        source.start(now, now % duration);
        fade.gain.setTargetAtTime(1, now, 0.01);

        const previous = channel.playing;
        if (previous) {
            previous.fade.gain.setTargetAtTime(0, now, 0.01);
            previous.source.onended = () => {
                previous.source.disconnect();
                previous.fade.disconnect();
            };
            previous.source.stop(now + 0.08);
        }
        channel.playing = { source, fade };
    }

    function updateSound(channel) {
        channel.version++;
        clearTimeout(channel.timer);
        channel.timer = setTimeout(() => renderPart(channel).catch(reportError), 60);
    }

    async function start() {
        if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
        const resumed = context.state === "running" ? Promise.resolve() : context.resume();

        if (!master) {
            master = context.createGain();
            master.gain.value = volume;
            const compressor = context.createDynamicsCompressor();
            compressor.threshold.value = -12;
            compressor.knee.value = 6;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.2;
            master.connect(compressor).connect(context.destination);
            impulse = makeImpulse();
            document.querySelectorAll(".panel").forEach((panel, i) => {
                channels.set(panel, makeChannel(panel, parts[i % parts.length]));
            });
        }

        await resumed;
        if (context.state !== "running") return;
        if (!ready) {
            ready = Promise.all([...channels.values()].map(renderPart)).catch((error) => {
                ready = null;
                throw error;
            });
        }
        return ready;
    }

    function setVolume(value) {
        volume = clamp(Number(value));
        if (master) change(master.gain, volume);
    }

    function reportError(error) {
        if (error.name !== "NotAllowedError") console.error("Could not start synthesizer:", error);
    }

    function knobValue(input) {
        return clamp((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)));
    }

    function bindKnob(input, update) {
        const min = Number(input.min);
        const step = (Number(input.max) - min) / 4;
        input.step = step;
        input.value = min + Math.round((Number(input.value) - min) / step) * step;
        let drag;

        input.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            input.focus();
            input.setPointerCapture(event.pointerId);
            drag = { id: event.pointerId, x: event.clientX, y: event.clientY, value: Number(input.value) };
        });
        input.addEventListener("pointermove", (event) => {
            if (!drag || drag.id !== event.pointerId) return;
            const steps = Math.round((event.clientX - drag.x + drag.y - event.clientY) / 14);
            const value = Math.max(min, Math.min(Number(input.max), drag.value + steps * step));
            if (Number(input.value) === value) return;
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        input.addEventListener("pointerup", () => { drag = null; });
        input.addEventListener("pointercancel", () => { drag = null; });
        input.addEventListener("lostpointercapture", () => { drag = null; });
        input.addEventListener("input", update);
        update();
    }

    function bindPanel(panel) {
        panel.querySelectorAll(".slider input").forEach((input) => {
            const min = Number(input.min);
            const step = (Number(input.max) - min) / 4;
            input.step = step;
            input.value = min + Math.round((Number(input.value) - min) / step) * step;

            const update = () => {
                const slider = input.closest(".slider");
                const value = Number(input.value);
                const position = (value - Number(input.min)) / (Number(input.max) - Number(input.min));
                slider.style.setProperty("--fill", "calc(7px + (100% - 14px) * " + position + ")");
                slider.querySelector("output").textContent = input.dataset.unit === "%"
                    ? value + " %" : value.toFixed(2) + " s";
                if (channels.has(panel)) updateSound(channels.get(panel));
            };
            input.addEventListener("input", update);
            update();
        });

        const buttons = panel.querySelectorAll("[data-wave]");
        buttons.forEach((button) => {
            button.addEventListener("click", () => {
                buttons.forEach((item) => {
                    const active = item === button;
                    item.classList.toggle("active", active);
                    item.setAttribute("aria-pressed", String(active));
                });
                if (channels.has(panel)) updateSound(channels.get(panel));
            });
        });

        panel.querySelectorAll(".effect input").forEach((input, i) => {
            bindKnob(input, () => {
                const value = knobValue(input);
                const effect = input.closest(".effect");
                const dial = input.closest(".dial");
                dial.style.setProperty("--arc", value * 270 + "deg");
                dial.style.setProperty("--angle", value * 270 - 135 + "deg");
                effect.querySelector("output").textContent = value.toFixed(2);
                input.setAttribute("aria-valuetext", value.toFixed(2));
                if (channels.has(panel)) {
                    setEffect(channels.get(panel)[["chorus", "delay", "reverb"][i]], value);
                }
            });
        });
    }

    function bindControls() {
        document.querySelectorAll(".panel").forEach(bindPanel);
        const activate = () => start().catch(reportError);
        ["click", "keydown", "pointerdown", "pointerup"].forEach((event) => {
            document.addEventListener(event, activate, true);
        });
        activate();
    }

    window.synthesizer = { start, setVolume };
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindControls, { once: true });
    } else {
        bindControls();
    }
})();
