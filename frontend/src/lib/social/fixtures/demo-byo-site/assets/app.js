// FakeYeast paper companion, BYO static-site fixture (demo lab). A tiny vanilla
// chart drawn with plain DOM elements (CSS bars) so the bundle has real
// JavaScript that runs in the sandboxed assets origin, without pulling a charting
// dependency.

(function () {
  "use strict";

  // Fabricated fakeGFP output (arbitrary units) by promoter strength bucket.
  var bars = [
    { label: "weak", value: 18 },
    { label: "medium", value: 44 },
    { label: "strong", value: 71 },
    { label: "very strong", value: 96 },
  ];

  var mount = document.getElementById("figure");
  if (!mount) return;

  var max = 100;
  var row = document.createElement("div");
  row.className = "chart";

  bars.forEach(function (bar) {
    var col = document.createElement("div");
    col.className = "chart-col";

    var value = document.createElement("span");
    value.className = "chart-value";
    value.textContent = String(bar.value);

    var fill = document.createElement("div");
    fill.className = "chart-bar";
    fill.style.height = ((bar.value / max) * 160).toFixed(0) + "px";

    var label = document.createElement("span");
    label.className = "chart-label";
    label.textContent = bar.label;

    col.appendChild(value);
    col.appendChild(fill);
    col.appendChild(label);
    row.appendChild(col);
  });

  mount.appendChild(row);
})();
