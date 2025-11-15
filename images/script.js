/**
 * Lucky Jet — полный сценарий (без сокращений)
 * - Кнопка скорости: Х1 → Х1.5 → Х2 (ускоряет весь полёт и вылет).
 * - Краш: основная масса в x1.10–x2.10, чем выше — тем реже (хвост до x4.50).
 * - После завершения раунда: 10-секундный кулдаун на кнопке старта с таймером.
 * - До старта Light.webp = 0, после старта = 0.9.
 * - Fire.svg прикреплён к правому борту персонажа, повернут по диагонали вправо и перевёрнут по Y.
 */

/* ======================== Конфигурация сцены ======================== */

const GlobalConfiguration = {
  preroundSeconds: 2.0,
  maximumCrashCap: 50.0,
  exitDurationMilliseconds: 180,

  groundPaddingPixels: 24,
  groundBasePixels: 16,

  heightScale: 0.62,
  yPowerGamma: 2.6,
  xPowerGammaDesktop: 0.82,
  xPowerGammaPhone: 0.86,

  rightReserveDesktopPixels: 24,
  rightReservePhonePixels: 28
};

/* ======================== Настройки пламени ======================== */

const FirePlacementSettings = {
  sideFactorFromWidth: 0.22,  // смещение вправо от центра джета (по перпендикуляру к курсу)
  backFactorFromWidth: 0.16,  // смещение назад по курсу
  downFactorFromHeight: 0.18, // опустить ниже борта
  angleDegreesRelativeToCourse: 32 // диагональ вправо относительно курса
};

/* ======================== Получение DOM-элементов ======================== */

const stageElement = document.getElementById("stage");
const coefficientCenterElement = document.getElementById("coeffCenter");

const luckyJetImageElement = document.getElementById("jet");
const preroundOverlayElement = document.getElementById("preUI");
const preroundFillElement = document.getElementById("preFill");
const startButtonElement = document.getElementById("startBtn");
const speedButtonElement = document.getElementById("speedBtn");

const trailPathElement = document.getElementById("trailPath");
const trailGlowElement = document.getElementById("trailGlow");
const trailFillElement = document.getElementById("trailFill");

let lightImageElement = document.getElementById("light");
let fireImageElement = document.getElementById("fire");
const preroundRingElement = preroundOverlayElement ? preroundOverlayElement.querySelector(".ring") : null;

/* ======================== Создание недостающих элементов ======================== */

// Лоадер внутри #preUI (load.svg)
let loaderImageElement = document.getElementById("roundLoader");
if (!loaderImageElement && preroundOverlayElement) {
  loaderImageElement = document.createElement("img");
  loaderImageElement.id = "roundLoader";
  loaderImageElement.src = "images/load.svg";
  loaderImageElement.alt = "Загрузка…";
  Object.assign(loaderImageElement.style, {
    width: "120px",
    height: "120px",
    opacity: "0",
    transition: "opacity 180ms ease",
    pointerEvents: "none",
    zIndex: "20"
  });
  const loaderHolder = document.createElement("div");
  Object.assign(loaderHolder.style, {
    position: "absolute",
    left: "50%",
    top: "25%",
    transform: "translate(-50%, -50%)",
    zIndex: "20"
  });
  loaderHolder.appendChild(loaderImageElement);
  preroundOverlayElement.appendChild(loaderHolder);
}

// Свечение позади джета
if (!lightImageElement) {
  lightImageElement = document.createElement("img");
  lightImageElement.id = "light";
  lightImageElement.src = "images/Light.webp";
  lightImageElement.alt = "";
  lightImageElement.loading = "eager";
  Object.assign(lightImageElement.style, {
    position: "absolute",
    left: "0",
    top: "0",
    transform: "translate(-9999px, -9999px)",
    pointerEvents: "none",
    userSelect: "none",
    mixBlendMode: "screen",
    opacity: "0", // по умолчанию скрыто
    transition: "opacity 180ms ease",
    zIndex: "3"
  });
  stageElement.appendChild(lightImageElement);
} else {
  lightImageElement.style.opacity = "0";
  lightImageElement.style.transition = "opacity 180ms ease";
}

// Пламя
if (!fireImageElement) {
  fireImageElement = document.createElement("img");
  fireImageElement.id = "fire";
  fireImageElement.src = "images/Fire.svg";
  fireImageElement.alt = "";
  fireImageElement.loading = "eager";
  Object.assign(fireImageElement.style, {
    position: "absolute",
    left: "0",
    top: "0",
    transform: "translate(-9999px, -9999px)",
    transformOrigin: "55% 85%",
    pointerEvents: "none",
    userSelect: "none",
    opacity: "0",
    zIndex: "7"
  });
  stageElement.appendChild(fireImageElement);
}

/* ======================== Состояние раунда ======================== */

let currentState = "idle"; // idle | preround | flying | crashed
let preroundStartHighRes = performance.now();
let flightStartHighRes = 0;

let currentCrashTarget = 2.0;
let frozenTrailPathD = "";
let smoothedProgress = 0;

// экспоненциальный рост коэффициента; на старте подгоняется, чтобы x1.10 было ровно к концу рывка
let currentAccelerationPerSecond = Math.log(1.10) / 1.25;

/* ======================== Управление скоростью воспроизведения ======================== */

const PlaybackController = {
  rate: 1.0, // 1.0 → 1.5 → 2.0
  updateSpeedButtonLabel: function () {
    if (!speedButtonElement) return;
    speedButtonElement.textContent =
      this.rate === 1 ? "Х1" : this.rate === 1.5 ? "Х1.5" : "Х2";
  },
  cycleSpeedRate: function () {
    if (this.rate === 1.0) this.rate = 1.5;
    else if (this.rate === 1.5) this.rate = 2.0;
    else this.rate = 1.0;
    this.updateSpeedButtonLabel();
  }
};
PlaybackController.updateSpeedButtonLabel();

/* ======================== Кулдаун кнопки старта ======================== */

const StartButtonCooldown = {
  defaultSeconds: 10,
  intervalId: null,

  begin: function (seconds) {
    if (!startButtonElement) return;

    const duration = typeof seconds === "number" ? seconds : this.defaultSeconds;

    clearInterval(this.intervalId);

    const originalLabel = startButtonElement.dataset.originalLabel || startButtonElement.textContent;
    startButtonElement.dataset.originalLabel = originalLabel;

    startButtonElement.disabled = true;
    startButtonElement.classList.add("is-cooldown");

    let secondsLeft = duration;
    startButtonElement.textContent = `Через ${secondsLeft}s`;
    startButtonElement.style.setProperty("--cd", "0%");

    this.intervalId = setInterval(() => {
      secondsLeft -= 1;
      const secondsPassed = duration - secondsLeft;
      const percent = Math.max(0, Math.min(100, (secondsPassed / duration) * 100));
      startButtonElement.style.setProperty("--cd", `${percent}%`);

      if (secondsLeft <= 0) {
        clearInterval(this.intervalId);
        startButtonElement.disabled = false;
        startButtonElement.classList.remove("is-cooldown");
        startButtonElement.textContent = startButtonElement.dataset.originalLabel || "Запустить раунд";
        startButtonElement.style.removeProperty("--cd");
      } else {
        startButtonElement.textContent = `Через ${secondsLeft}s`;
      }
    }, 1000);
  }
};

/* ======================== Вспомогательные функции ======================== */

function clampValueBetween(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function generateRandomNumberInRange(minValue, maxValue) {
  return Math.random() * (maxValue - minValue) + minValue;
}

function easeInOutCubic(normalizedTime) {
  return normalizedTime < 0.5
    ? 4 * normalizedTime * normalizedTime * normalizedTime
    : 1 - Math.pow(-2 * normalizedTime + 2, 3) / 2;
}

/**
 * Выбор коэффициента краша с сильным перекосом к диапазону [1.10, 2.10]
 * и редким хвостом до 4.50 (чем выше — тем реже).
 * ~80% значений попадает в [1.10, 2.10]; остальные — в [2.10, 4.50] по усечённой экспоненте.
 */
function chooseBiasedCrashCoefficient() {
  const minX = 1.10;
  const mainUpperX = 2.10;
  const maxX = 4.50;

  const coin = Math.random();

  if (coin < 0.80) {
    // Основная масса: лёгкий перекос к низу, но без прилипания к 1.10
    const u = Math.random();
    const betaShape = 1.35;
    const value = minX + (mainUpperX - minX) * Math.pow(u, betaShape);
    return Number((value + 1e-8).toFixed(2));
  } else {
    // Хвост: усечённая экспонента — большие x редки
    const w = Math.random();
    const lambda = 2.2;
    const denom = 1 - Math.exp(-lambda * (maxX - mainUpperX));
    const value = mainUpperX - (1 / lambda) * Math.log(1 - denom * w);
    return Number((Math.min(value, maxX) + 1e-8).toFixed(2));
  }
}

/**
 * Текущий коэффициент от прошедшего времени (сек), ограниченный сверху.
 */
function coefficientFromElapsedSeconds(elapsedSeconds) {
  const raw = Math.exp(currentAccelerationPerSecond * elapsedSeconds);
  return clampValueBetween(raw, 1.0, GlobalConfiguration.maximumCrashCap);
}

/* ======================== Геометрия траектории ======================== */

function getOriginPoint() {
  const stageHeight = stageElement.clientHeight;
  return {
    x: GlobalConfiguration.groundPaddingPixels,
    y: stageHeight - (GlobalConfiguration.groundPaddingPixels + GlobalConfiguration.groundBasePixels)
  };
}

function getPointForProgress(progress) {
  const stageWidth = stageElement.clientWidth;
  const stageHeight = stageElement.clientHeight;
  const isPhone = stageWidth <= 560;

  const xGamma = isPhone ? GlobalConfiguration.xPowerGammaPhone : GlobalConfiguration.xPowerGammaDesktop;
  const yGamma = isPhone ? GlobalConfiguration.yPowerGamma * 1.06 : GlobalConfiguration.yPowerGamma;
  const heightScale = isPhone ? Math.min(0.70, GlobalConfiguration.heightScale + 0.08) : GlobalConfiguration.heightScale;
  const horizontalPadding = isPhone ? Math.max(14, GlobalConfiguration.groundPaddingPixels - 6) : GlobalConfiguration.groundPaddingPixels;
  const rightReserve = isPhone ? GlobalConfiguration.rightReservePhonePixels : GlobalConfiguration.rightReserveDesktopPixels;

  const p = clampValueBetween(progress, 0, 1);
  const x = Math.pow(p, xGamma) * (stageWidth - horizontalPadding * 2 - rightReserve) + horizontalPadding;
  const y = stageHeight - (Math.pow(p, yGamma) * (stageHeight * heightScale) + (horizontalPadding + GlobalConfiguration.groundBasePixels));
  return { x, y };
}

/* ======================== След (кривая) ======================== */

function buildBezierPathsFromSamples(samplePoints, baseY) {
  if (samplePoints.length < 2) {
    const only = samplePoints[0];
    return { stroke: `M ${only.x} ${only.y}`, fill: `M ${only.x} ${baseY} L ${only.x} ${only.y} Z` };
  }

  const points = [samplePoints[0], samplePoints[0], ...samplePoints.slice(1, -1), samplePoints[samplePoints.length - 1], samplePoints[samplePoints.length - 1]];
  let strokePath = `M ${points[1].x} ${points[1].y}`;
  let fillPath = `M ${points[1].x} ${baseY} L ${points[1].x} ${points[1].y}`;

  for (let i = 1; i < points.length - 2; i++) {
    const p0 = points[i - 1], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2];
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    strokePath += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    fillPath += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }

  const lastPoint = samplePoints[samplePoints.length - 1];
  fillPath += ` L ${lastPoint.x} ${baseY} Z`;
  return { stroke: strokePath, fill: fillPath };
}

function rebuildTrailUpToProgress(progress) {
  const origin = getOriginPoint();
  const samplesCount = Math.max(18, Math.floor(120 * progress));
  const samples = [];

  for (let i = 0; i <= samplesCount; i++) {
    const t = (i / samplesCount) * progress;
    samples.push(getPointForProgress(t));
  }

  const paths = buildBezierPathsFromSamples([origin, ...samples], origin.y);
  trailPathElement.setAttribute("d", paths.stroke);
  trailGlowElement.setAttribute("d", paths.stroke);
  trailFillElement.setAttribute("d", paths.fill);
  return { d: paths.stroke };
}

/* ======================== Позиционирование джета, света и пламени ======================== */

function positionJetAndDecorationsForProgress(progress) {
  const curvePoint = getPointForProgress(progress);
  const visualRotationDegrees = 8 + progress * 12;

  const translateX = curvePoint.x + 6;
  const translateY = curvePoint.y - 2;

  // Сам джет
  luckyJetImageElement.style.transform = `translate(${translateX}px, ${translateY}px) rotate(${visualRotationDegrees}deg)`;

  // Геометрия джета
  const jetBounds = luckyJetImageElement.getBoundingClientRect();
  const jetWidth = jetBounds.width || 150;
  const jetHeight = jetBounds.height || 150;

  // «Опорная» точка ~в центре корпуса (transform-origin: 40% 50%)
  const anchorX = translateX + jetWidth * 0.40;
  const anchorY = translateY + jetHeight * 0.50;

  // Направление курса
  const radians = (visualRotationDegrees * Math.PI) / 180;
  const dirX = Math.cos(radians);
  const dirY = Math.sin(radians);

  // Перпендикуляр вправо к курсу
  const rightX = dirY;
  const rightY = -dirX;

  /* ---- Пламя (Fire.svg) ---- */
  fireImageElement.style.animation = "none";
  const sideOffset = jetWidth * FirePlacementSettings.sideFactorFromWidth;
  const backOffset = jetWidth * FirePlacementSettings.backFactorFromWidth;
  const downOffset = jetHeight * FirePlacementSettings.downFactorFromHeight;

  const fireX = anchorX + rightX * sideOffset - dirX * backOffset;
  const fireY = anchorY + rightY * sideOffset - dirY * backOffset + downOffset;

  fireImageElement.style.transformOrigin = "55% 85%";
  fireImageElement.style.transform =
    `translate(${fireX}px, ${fireY}px) rotate(${visualRotationDegrees + FirePlacementSettings.angleDegreesRelativeToCourse}deg) scaleY(-1)`;
  if (currentState === "flying") fireImageElement.style.opacity = "1";

  /* ---- Свечение (Light.webp) ---- */
  const backForLight = jetWidth * 0.32;
  const lightCenterX = anchorX - dirX * backForLight;
  const lightCenterY = anchorY - dirY * backForLight;

  const stageWidth = stageElement.clientWidth;
  const lightSize = Math.max(220, Math.min(360, stageWidth * 0.32));
  lightImageElement.style.width = `${lightSize}px`;
  lightImageElement.style.transform = `translate(${lightCenterX - lightSize / 2}px, ${lightCenterY - lightSize / 2}px)`;

  return curvePoint;
}

/* ======================== Параметры полёта ======================== */

const FlightParameters = {
  boostDurationMilliseconds: 1200,
  holdProgress: 0.935,
  swayAmplitude: 0.011,
  swayFrequencyHertz: 0.36,
  swayRampSeconds: 1.0,
  smoothingAlphaDuringBoost: 0.35,
  smoothingAlphaDuringHold: 0.14,
  maximumAllowedProgress: 0.965
};

function computeTargetProgress(millisecondsSinceStart) {
  if (millisecondsSinceStart <= FlightParameters.boostDurationMilliseconds) {
    const normalized = clampValueBetween(millisecondsSinceStart / FlightParameters.boostDurationMilliseconds, 0, 1);
    return { target: easeInOutCubic(normalized) * FlightParameters.holdProgress, isHolding: false };
  }

  const secondsAfterBoost = (millisecondsSinceStart - FlightParameters.boostDurationMilliseconds) / 1000;
  const ramp = clampValueBetween(secondsAfterBoost / FlightParameters.swayRampSeconds, 0, 1);
  const sway = (FlightParameters.swayAmplitude * ramp) *
               Math.sin(2 * Math.PI * FlightParameters.swayFrequencyHertz * secondsAfterBoost);
  const raw = FlightParameters.holdProgress + sway;
  return { target: clampValueBetween(raw, 0.02, FlightParameters.maximumAllowedProgress), isHolding: true };
}

/* ======================== Фазы раунда ======================== */

function switchToPreround() {
  currentState = "preround";
  preroundStartHighRes = performance.now();
  coefficientCenterElement.textContent = "x1.00";

  currentCrashTarget = chooseBiasedCrashCoefficient();
  frozenTrailPathD = "";
  smoothedProgress = 0;

  preroundOverlayElement.classList.add("show");
  if (startButtonElement) startButtonElement.disabled = true;
  if (preroundRingElement) preroundRingElement.style.display = "none";
  if (loaderImageElement) loaderImageElement.style.opacity = "1";

  luckyJetImageElement.style.opacity = "0";
  lightImageElement.style.opacity = "0";

  trailPathElement.setAttribute("d", "");
  trailGlowElement.setAttribute("d", "");
  trailFillElement.setAttribute("d", "");
  fireImageElement.style.opacity = "0";

  positionJetAndDecorationsForProgress(0);
  rebuildTrailUpToProgress(0);

  requestAnimationFrame(preroundLoop);
}

function switchToFlying() {
  currentState = "flying";
  preroundOverlayElement.classList.remove("show");
  luckyJetImageElement.classList.add("fly");
  luckyJetImageElement.style.opacity = "1";
  if (loaderImageElement) loaderImageElement.style.opacity = "0";
  lightImageElement.style.opacity = "0.9";

  const stageWidth = stageElement.clientWidth;
  const isPhone = stageWidth <= 560;

  // рывок до x1.10 за 1.0–1.5 с
  const boostSeconds = generateRandomNumberInRange(1.0, 1.5);
  currentAccelerationPerSecond = Math.log(1.10) / boostSeconds;
  FlightParameters.boostDurationMilliseconds = boostSeconds * 1000;

  // удержание у правого края, но не выходя за секцию
  FlightParameters.holdProgress = isPhone ? 0.945 : 0.935;

  // плавное покачивание
  FlightParameters.swayAmplitude = isPhone ? 0.014 : 0.011;
  FlightParameters.swayFrequencyHertz = isPhone ? 0.40 : 0.36;
  FlightParameters.swayRampSeconds = 1.0;

  FlightParameters.smoothingAlphaDuringBoost = 0.35;
  FlightParameters.smoothingAlphaDuringHold = 0.14;

  FlightParameters.maximumAllowedProgress =
    Math.min(0.965, FlightParameters.holdProgress + FlightParameters.swayAmplitude + 0.006);

  flightStartHighRes = performance.now();
  fireImageElement.style.opacity = "1";

  requestAnimationFrame(flyingLoop);
}

function switchToCrashed() {
  currentState = "crashed";
  stageElement.classList.add("shake");
  setTimeout(() => stageElement.classList.remove("shake"), 360);

  // после короткой паузы: возвращаемся в idle и запускаем 10-секундный кулдаун кнопки старта
  setTimeout(() => {
    currentState = "idle";
    StartButtonCooldown.begin(10);
  }, 280);
}

/* ======================== Лупы фаз ======================== */

function preroundLoop() {
  if (currentState !== "preround") return;

  const elapsedSeconds = (performance.now() - preroundStartHighRes) / 1000;
  const fillRatio = clampValueBetween(elapsedSeconds / GlobalConfiguration.preroundSeconds, 0, 1);
  preroundFillElement.style.width = (fillRatio * 100).toFixed(1) + "%";

  if (fillRatio >= 1) {
    switchToFlying();
    return;
  }
  requestAnimationFrame(preroundLoop);
}

function flyingLoop() {
  if (currentState !== "flying") return;

  const now = performance.now();

  // ускоряем внутреннее «время полёта» согласно выбранной скорости
  const elapsedSecondsAdjusted = ((now - flightStartHighRes) / 1000) * PlaybackController.rate;
  const elapsedMillisecondsAdjusted = (now - flightStartHighRes) * PlaybackController.rate;

  // коэффициент
  const currentCoefficient = coefficientFromElapsedSeconds(elapsedSecondsAdjusted);
  coefficientCenterElement.textContent = "x" + currentCoefficient.toFixed(2);

  // прогресс по кривой
  const target = computeTargetProgress(elapsedMillisecondsAdjusted);
  const smoothingAlpha = target.isHolding ? FlightParameters.smoothingAlphaDuringHold
                                          : FlightParameters.smoothingAlphaDuringBoost;
  const newProgress = smoothedProgress + (target.target - smoothedProgress) * smoothingAlpha;
  smoothedProgress = newProgress;

  positionJetAndDecorationsForProgress(newProgress);
  const trailPaths = rebuildTrailUpToProgress(newProgress);

  // проверка на краш
  if (currentCoefficient >= currentCrashTarget) {
    frozenTrailPathD = trailPaths.d;

    // направляющий вектор касательной
    const epsilon = 0.002;
    const previousProgress = clampValueBetween(newProgress - epsilon, 0, FlightParameters.maximumAllowedProgress);
    const pointA = getPointForProgress(previousProgress);
    const pointB = getPointForProgress(newProgress);

    const velocityX = pointB.x - pointA.x;
    const velocityY = pointB.y - pointA.y;
    const length = Math.hypot(velocityX, velocityY) || 1;
    const unitX = velocityX / length;
    const unitY = velocityY / length;

    const exitStartPoint = pointB;
    const exitRotationDegrees = 8 + newProgress * 12;
    const exitStartHighRes = performance.now();

    trailPathElement.setAttribute("d", frozenTrailPathD);
    trailGlowElement.setAttribute("d", frozenTrailPathD);

    function exitLoop() {
      const elapsedAdj = (performance.now() - exitStartHighRes) * PlaybackController.rate;
      const pixelsPerMillisecond = 360 / GlobalConfiguration.exitDurationMilliseconds;

      const exitX = exitStartPoint.x + unitX * pixelsPerMillisecond * elapsedAdj;
      const exitY = exitStartPoint.y + unitY * pixelsPerMillisecond * elapsedAdj;

      const translateX = exitX + 6;
      const translateY = exitY - 2;
      luckyJetImageElement.style.transform = `translate(${translateX}px, ${translateY}px) rotate(${exitRotationDegrees}deg)`;

      // синхронизация пламени и свечения на вылете
      const jetBounds = luckyJetImageElement.getBoundingClientRect();
      const jetWidth = jetBounds.width || 150;
      const jetHeight = jetBounds.height || 150;
      const anchorX = translateX + jetWidth * 0.40;
      const anchorY = translateY + jetHeight * 0.50;

      const radiansExit = (exitRotationDegrees * Math.PI) / 180;
      const dirX = Math.cos(radiansExit), dirY = Math.sin(radiansExit);
      const rightX = dirY, rightY = -dirX;

      const fireX = anchorX + rightX * (jetWidth * FirePlacementSettings.sideFactorFromWidth) - dirX * (jetWidth * FirePlacementSettings.backFactorFromWidth);
      const fireY = anchorY + rightY * (jetWidth * FirePlacementSettings.sideFactorFromWidth) - dirY * (jetWidth * FirePlacementSettings.backFactorFromWidth) + (jetHeight * FirePlacementSettings.downFactorFromHeight);
      fireImageElement.style.transformOrigin = "55% 85%";
      fireImageElement.style.transform =
        `translate(${fireX}px, ${fireY}px) rotate(${exitRotationDegrees + FirePlacementSettings.angleDegreesRelativeToCourse}deg) scaleY(-1)`;

      const lightCenterX = anchorX - dirX * (jetWidth * 0.32);
      const lightCenterY = anchorY - dirY * (jetWidth * 0.32);
      const stageWidth = stageElement.clientWidth;
      const lightSize = Math.max(220, Math.min(360, stageWidth * 0.32));
      lightImageElement.style.width = `${lightSize}px`;
      lightImageElement.style.transform = `translate(${lightCenterX - lightSize / 2}px, ${lightCenterY - lightSize / 2}px)`;

      if (elapsedAdj < GlobalConfiguration.exitDurationMilliseconds) {
        requestAnimationFrame(exitLoop);
      } else {
        switchToCrashed();
      }
    }

    requestAnimationFrame(exitLoop);
    return;
  }

  requestAnimationFrame(flyingLoop);
}

/* ======================== Инициализация и события ======================== */

function initialize() {
  currentState = "idle";
  lightImageElement.style.opacity = "0";
  positionJetAndDecorationsForProgress(0);
  rebuildTrailUpToProgress(0);

  if (startButtonElement && !startButtonElement.dataset.originalLabel) {
    startButtonElement.dataset.originalLabel = startButtonElement.textContent;
  }

  if (startButtonElement) {
    startButtonElement.addEventListener("click", function () {
      if (currentState === "idle") {
        switchToPreround();
      }
    });
  }

  if (speedButtonElement) {
    speedButtonElement.addEventListener("click", function () {
      PlaybackController.cycleSpeedRate();
    });
  }
}

initialize();
