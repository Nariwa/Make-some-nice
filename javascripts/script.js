(() => {
    "use strict";

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    function setupPanel(panel) {
    panel.querySelectorAll(".slider input").forEach((input) => {
    function update() {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const progress = clamp((value - min) / (max - min), 0, 1);
    const slider = input.closest(".slider");

    slider.style.setProperty(
    "--fill",
    `calc(0.5vw + (100% - 1vw) * ${progress})`
    );
    slider.querySelector("output").textContent = input.dataset.unit === "%"
    ? `${Number.isInteger(value) ? value : value.toFixed(1)} %`
    : `${value.toFixed(2)} s`;
    }

    input.addEventListener("input", update);
    update();
});

const buttons = [...panel.querySelectorAll("[data-wave]")];
buttons.forEach((button) => {
button.addEventListener("click", () => {
    buttons.forEach((item) => {
    const selected = item === button;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-pressed", String(selected));
    });
    });
    });

    panel.querySelectorAll(".effect input").forEach((input) => {
    const dial = input.closest(".dial");
    const output = input.closest(".effect").querySelector("output");
    let drag = null;

    function update() {
        const min = Number(input.min);
        const max = Number(input.max);
        const progress = clamp((Number(input.value) - min) / (max - min), 0, 1);
        dial.style.setProperty("--arc", `${progress * 270}deg`);
        dial.style.setProperty("--angle", `${progress * 270 - 135}deg`);
        output.textContent = Number(input.value).toFixed(2);
        input.setAttribute("aria-valuetext", output.textContent);
    }

        input.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        input.focus();
        input.setPointerCapture(event.pointerId);
        drag = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            value: Number(input.value)
        };
        });

        input.addEventListener("pointermove", (event) => {
        if (!drag || event.pointerId !== drag.id) return;
        const min = Number(input.min);
        const max = Number(input.max);
        const step = Number(input.step) || 0.01;
        const distance = event.clientX - drag.x + drag.y - event.clientY;
        const value = clamp(
        Math.round((drag.value + distance * 0.005) / step) * step,
        min,
        max
        );
        if (Number(input.value) === value) return;
        input.value = String(Number(value.toFixed(3)));
        input.dispatchEvent(new Event("input", { bubbles: true }));
        });

        function finishDrag() { drag = null; }
        input.addEventListener("pointerup", finishDrag);
        input.addEventListener("pointercancel", finishDrag);
        input.addEventListener("lostpointercapture", finishDrag);
        input.addEventListener("input", update);
        update();
    });
    }

    document.querySelectorAll(".panel").forEach(setupPanel);
})();
