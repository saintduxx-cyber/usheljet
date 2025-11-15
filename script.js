/**
 * Полностью адаптивный Lucky Jet:
 * - Лоадер (load.svg + текст + полоса) выстроен в колонку, масштабируется и не перекрывается.
 * - Lucky.webp, Fire.svg, Light.webp остаются «склеенными» как на ПК и
 *   пропорционально уменьшаются на телефонах через локальный «rem» окна (em-единицы).
 * - Сохранены все предыдущие фичи: кнопка скорости (Х1→Х1.5→Х2), кулдаун 10 c после раунда,
 *   распределение краша с уклоном к x1.10–x2.10 и «хвостом» до 4.50, плавные 3 фазы полёта.
 * - Исправлено: пламя Fire.svg управляется через CSS-переменные (--fx/--fy/--fa), чтобы не конфликтовать с анимацией.
 */

/* ======================== ГЛОБАЛЬНАЯ КОНФИГУРАЦИЯ ======================== */

const GlobalConfiguration = {
  preroundSeconds: 2.0,
  maximumCrashCap: 50.0,
  exitDurationMilliseconds: 180,

  baseGroundBasePixels: 16,           // базовая «земля»
  baseHeightScale: 0.62,
  baseYGamma: 2.6,
  baseXGammaDesktop: 0.82,
  baseXGammaPhone: 0.86
};

/* ======================== ДИНАМИЧЕСКИЙ ЛЕЙАУТ (под размеры окна) ======================== */

const LayoutSettings = {
  horizontalPadding: 24,
  groundBase: 16,
  heightScale: 0.62,
  xGamma: 0.82,
  yGamma: 2.6,
  rightReserve: 24,

  recomputeFromStage: function(stageWidth, stageHeight){
    const isPhone = stageWidth <= 560;

    // локальный «rem» для окна: 16px при 900px ширины, пропорционально меньше на телефонах
    const uiRem = Math.max(8, Math.min(16, (stageWidth / 900) * 16));
    stageElement.style.setProperty('--ui-rem', `${uiRem}px`);

    // паддинги и отступ справа зависят от ширины
    this.horizontalPadding = Math.round(Math.max(10, Math.min(22, stageWidth * 0.035)));
    this.rightReserve = Math.round(isPhone ? Math.max(16, Math.min(30, stageWidth * 0.05))
                                           : Math.max(18, Math.min(28, stageWidth * 0.035)));

    this.groundBase = GlobalConfiguration.baseGroundBasePixels;
    this.heightScale = isPhone ? Math.max(0.60, Math.min(0.72, GlobalConfiguration.baseHeightScale + 0.06))
                               : GlobalConfiguration.baseHeightScale;
    this.xGamma = isPhone ? GlobalConfiguration.baseXGammaPhone : GlobalConfiguration.baseXGammaDesktop;
    this.yGamma = isPhone ? GlobalConfiguration.baseYGamma * 1.06 : GlobalConfiguration.baseYGamma;
  }
};

/* ======================== ПАРАМЕТРЫ СПРАЙТА ПЛАМЕНИ ======================== */

const FirePlacementSettings = {
  sideFactorFromWidth: 0.22,
  backFactorFromWidth: 0.16,
  downFactorFromHeight: 0.18,
  angleDegreesRelativeToCourse: 32
};

/* ======================== DOM-ЭЛЕМЕНТЫ ======================== */

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

/* ======================== СОЗДАНИЕ / ПЕРЕВЁРСТКА ЛОАДЕРА ======================== */

function ensureLoaderStackLayout(){
  // создать контейнер-стек, если его ещё нет
  let stack = preroundOverlayElement.querySelector(".preui__stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "preui__stack";

    // переносим существующие элементы вовнутрь (заголовок и прогресс)
    const title = preroundOverlayElement.querySelector(".preui__title") || (()=>{
      const t = document.createElement("div"); t.className="preui__title"; t.textContent="Ловим сигнал…"; return t;
    })();
    const bar = preroundOverlayElement.querySelector(".preui__bar");
    const fill = preroundOverlayElement.querySelector(".preui__fill");
    if (!bar){
      const b = document.createElement("div"); b.className="preui__bar";
      const f = document.createElement("div"); f.className="preui__fill"; f.id="preFill";
      b.appendChild(f); preroundOverlayElement.appendChild(b);
    }

    // узел для loader image
    const loaderHolder = document.createElement("div");
    loaderHolder.className = "preui__loader";

    // сам loader image (load.svg)
    let loader = document.getElementById("roundLoader");
    if (!loader) {
      loader = document.createElement("img");
      loader.id = "roundLoader";
      loader.src = "images/load.svg";
      loader.alt = "Загрузка…";
    }
    loader.style.opacity = "1";
    loader.style.transition = "opacity 180ms ease";
    loaderHolder.appendChild(loader);

    // собрать стек
    stack.appendChild(loaderHolder);
    stack.appendChild(title);
    const actualBar = preroundOverlayElement.querySelector(".preui__bar");
    stack.appendChild(actualBar);

    // убрать старую ring (если была), чтобы не дублировалась
    const ring = preroundOverlayElement.querySelector(".ring");
    if (ring) ring.remove();

    // очистить и вставить стек
    preroundOverlayElement.innerHTML = "";
    preroundOverlayElement.appendChild(stack);
  }
}

/* ======================== СОСТОЯНИЕ/ФИЗИКА ======================== */

let currentState = "idle"; // idle | preround | flying | crashed
let preroundStartHighRes = performance.now();
let flightStartHighRes = 0;

let currentCrashTarget = 2.0;
let frozenTrailPathD = "";
let smoothedProgress = 0;

// экспонента подгоняется так, чтобы к концу рывка было ровно x1.10
let currentAccelerationPerSecond = Math.log(1.10) / 1.25;

/* ===== скорость воспроизведения ===== */
const PlaybackController = {
  rate: 1.0,
  updateSpeedButtonLabel: function(){
    if (!speedButtonElement) return;
    speedButtonElement.textContent = this.rate === 1 ? "Х1" : this.rate === 1.5 ? "Х1.5" : "Х2";
  },
  cycleSpeedRate: function(){
    if (this.rate === 1.0) this.rate = 1.5;
    else if (this.rate === 1.5) this.rate = 2.0;
    else this.rate = 1.0;
    this.updateSpeedButtonLabel();
  }
};
PlaybackController.updateSpeedButtonLabel();

/* ===== кулдаун кнопки старта ===== */
const StartButtonCooldown = {
  defaultSeconds: 15, intervalId: null,
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
        startButtonElement.textContent = startButtonElement.dataset.originalLabel || "ПОЛУЧИТЬ СИГНАЛ";
        startButtonElement.style.removeProperty("--cd");
      } else {
        startButtonElement.textContent = `Через ${secondsLeft}s`;
      }
    }, 1000);
  }
};

/* ===== утилиты ===== */
function clampValueBetween(v, a, b){ return Math.max(a, Math.min(b, v)); }
function generateRandomNumberInRange(a, b){ return Math.random() * (b - a) + a; }
function easeInOutCubic(t){ return t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2; }

/* распределение краша: ~80% в [1.10, 2.10], хвост до 4.50 */
let Crash = []; // Массив для хранения значений X
let currentCrashIndex = 0;   // Индекс текущего X из массива

// Функция для установки списка коэффициентов X
function setCrash(values) {
  if (Array.isArray(values) && values.length === 5) {
    Crash = values.filter(v => v >= 1.10 && v <= 4.50);
    if (Crash.length === 5) {
      console.log(`Коэффициенты X установлены: ${Crash.join(", ")}`);
    } else {
      console.error('Некоторые значения недопустимы! Все значения должны быть в пределах от 1.10 до 4.50.');
    }
  } else {
    console.error('Неверный формат ввода! Пожалуйста, передайте массив из 5 чисел.');
  }
}

// Функция для получения следующего коэффициента X из массива
function chooseBiasedCrashCoefficient(){
  if (Crash.length > 0) {
    const value = Crash[currentCrashIndex];
    currentCrashIndex = (currentCrashIndex + 1) % Crash.length; // Циклический выбор
    return value;
  }

  const minX = 1.10, topMain = 2.10, maxX = 4.50;
  if (Math.random() < 0.80){
    const u = Math.random(), beta = 1.35;
    return Number((minX + (topMain - minX) * Math.pow(u, beta) + 1e-8).toFixed(2));
  } else {
    const w = Math.random(), lambda = 2.2, denom = 1 - Math.exp(-lambda * (maxX - topMain));
    const x = topMain - (1 / lambda) * Math.log(1 - denom * w);
    return Number((Math.min(x, maxX) + 1e-8).toFixed(2));
  }
}

function coefficientFromElapsedSeconds(sec){
  const raw = Math.exp(currentAccelerationPerSecond * sec);
  return clampValueBetween(raw, 1.0, GlobalConfiguration.maximumCrashCap);
}

/* ===== геометрия ===== */
function getOriginPoint(){
  const stageHeight = stageElement.clientHeight;
  return { x: LayoutSettings.horizontalPadding,
           y: stageHeight - (LayoutSettings.horizontalPadding + GlobalConfiguration.baseGroundBasePixels) };
}
function getPointForProgress(progress){
  const stageWidth = stageElement.clientWidth, stageHeight = stageElement.clientHeight;
  const p = clampValueBetween(progress, 0, 1);
  const x = Math.pow(p, LayoutSettings.xGamma) * (stageWidth - LayoutSettings.horizontalPadding*2 - LayoutSettings.rightReserve) + LayoutSettings.horizontalPadding;
  const y = stageHeight - (Math.pow(p, LayoutSettings.yGamma) * (stageHeight * LayoutSettings.heightScale) + (LayoutSettings.horizontalPadding + LayoutSettings.groundBase));
  return { x, y };
}

/* ===== след ===== */
function buildBezierPathsFromSamples(samples, baseY){
  if (samples.length < 2){
    const only = samples[0];
    return { stroke:`M ${only.x} ${only.y}`, fill:`M ${only.x} ${baseY} L ${only.x} ${only.y} Z` };
  }
  const pts = [samples[0], samples[0], ...samples.slice(1,-1), samples[samples.length-1], samples[samples.length-1]];
  let stroke = `M ${pts[1].x} ${pts[1].y}`;
  let fill   = `M ${pts[1].x} ${baseY} L ${pts[1].x} ${pts[1].y}`;
  for (let i=1;i<pts.length-2;i++){
    const p0=pts[i-1], p1=pts[i], p2=pts[i+1], p3=pts[i+2];
    const c1x=p1.x+(p2.x-p0.x)/6, c1y=p1.y+(p2.y-p0.y)/6;
    const c2x=p2.x-(p3.x-p1.x)/6, c2y=p2.y-(p3.y-p1.y)/6;
    stroke += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
    fill   += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  const last = samples[samples.length-1];
  fill += ` L ${last.x} ${baseY} Z`;
  return { stroke, fill };
}
function rebuildTrailUpToProgress(progress){
  const origin=getOriginPoint();
  const count=Math.max(18, Math.floor(120*progress));
  const s=[];
  for(let i=0;i<=count;i++){
    const t=(i/count)*progress;
    s.push(getPointForProgress(t));
  }
  const paths=buildBezierPathsFromSamples([origin, ...s], origin.y);
  trailPathElement.setAttribute("d", paths.stroke);
  trailGlowElement.setAttribute("d", paths.stroke);
  trailFillElement.setAttribute("d", paths.fill);
  return { d: paths.stroke };
}

/* ===== позиционирование спрайта (все части вместе) ===== */
function positionJetAndDecorationsForProgress(progress){
  const pt=getPointForProgress(progress);
  const rot=8 + progress*12;
  const jx=pt.x + 6, jy=pt.y - 2;

  luckyJetImageElement.style.transform = `translate(${jx}px, ${jy}px) rotate(${rot}deg)`;

  const jb=luckyJetImageElement.getBoundingClientRect();
  const jw=jb.width|| (7.5 * parseFloat(getComputedStyle(stageElement).getPropertyValue('--ui-rem')||'16'));
  const jh=jb.height|| jw; // пропорционально

  const anchorX=jx + jw*0.40;
  const anchorY=jy + jh*0.50;

  const rad=rot * Math.PI/180;
  const dirX=Math.cos(rad), dirY=Math.sin(rad);
  const rightX=dirY, rightY=-dirX;

  // Fire — подаём координаты и угол в CSS-переменные, чтобы анимация flame не затирала transform
  const offsetSide=jw*FirePlacementSettings.sideFactorFromWidth;
  const offsetBack=jw*FirePlacementSettings.backFactorFromWidth;
  const offsetDown=jh*FirePlacementSettings.downFactorFromHeight;
  const fx=anchorX + rightX*offsetSide - dirX*offsetBack;
  const fy=anchorY + rightY*offsetSide - dirY*offsetBack + offsetDown;

  fireImageElement.style.transformOrigin="55% 85%";
  fireImageElement.style.setProperty("--fx", `${fx}px`);
  fireImageElement.style.setProperty("--fy", `${fy}px`);
  fireImageElement.style.setProperty("--fa", `${rot + FirePlacementSettings.angleDegreesRelativeToCourse}deg`);
  if (currentState==="flying") fireImageElement.style.opacity = "1";

  // Light
  const back=jw*0.32;
  const cx=anchorX - dirX*back;
  const cy=anchorY - dirY*back;
  const stageW=stageElement.clientWidth;
  const lightSize=Math.max(220, Math.min(360, stageW*0.32));
  lightImageElement.style.width = `${lightSize}px`;
  lightImageElement.style.transform = `translate(${cx - lightSize/2}px, ${cy - lightSize/2}px)`;

  return pt;
}

/* ===== параметры полёта ===== */
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
function computeTargetProgress(ms){
  if (ms <= FlightParameters.boostDurationMilliseconds){
    const k = clampValueBetween(ms / FlightParameters.boostDurationMilliseconds, 0, 1);
    return { target: easeInOutCubic(k) * FlightParameters.holdProgress, isHolding:false };
  }
  const t=(ms - FlightParameters.boostDurationMilliseconds)/1000;
  const ramp=clampValueBetween(t / FlightParameters.swayRampSeconds, 0, 1);
  const sway=(FlightParameters.swayAmplitude * ramp) * Math.sin(2*Math.PI*FlightParameters.swayFrequencyHertz * t);
  const raw=FlightParameters.holdProgress + sway;
  return { target: clampValueBetween(raw, 0.02, FlightParameters.maximumAllowedProgress), isHolding:true };
}

/* ===== фазы ===== */
function switchToPreround(){
  currentState="preround";
  preroundStartHighRes=performance.now();
  coefficientCenterElement.textContent="x1.00";

  ensureLoaderStackLayout();              // привести лоадер к адаптивному стеку

  currentCrashTarget=chooseBiasedCrashCoefficient();
  frozenTrailPathD="";
  smoothedProgress=0;

  preroundOverlayElement.classList.add("show");
  startButtonElement.disabled = true;

  luckyJetImageElement.style.opacity="0";
  lightImageElement.style.opacity="0";
  fireImageElement.style.opacity="0";

  trailPathElement.setAttribute("d","");
  trailGlowElement.setAttribute("d","");
  trailFillElement.setAttribute("d","");

  positionJetAndDecorationsForProgress(0);
  rebuildTrailUpToProgress(0);

  requestAnimationFrame(preroundLoop);
}
function switchToFlying(){
  currentState="flying";
  preroundOverlayElement.classList.remove("show");
  luckyJetImageElement.classList.add("fly");
  luckyJetImageElement.style.opacity="1";
  lightImageElement.style.opacity="0.9";

  const stageWidth=stageElement.clientWidth;
  const isPhone=stageWidth<=560;

  const boostSec=generateRandomNumberInRange(1.0, 1.5);
  currentAccelerationPerSecond=Math.log(1.10)/boostSec;
  FlightParameters.boostDurationMilliseconds=boostSec*1000;

  FlightParameters.holdProgress=isPhone ? 0.945 : 0.935;
  FlightParameters.swayAmplitude=isPhone ? 0.014 : 0.011;
  FlightParameters.swayFrequencyHertz=isPhone ? 0.40 : 0.36;
  FlightParameters.swayRampSeconds=1.0;
  FlightParameters.smoothingAlphaDuringBoost=0.35;
  FlightParameters.smoothingAlphaDuringHold=0.14;
  FlightParameters.maximumAllowedProgress=Math.min(0.965, FlightParameters.holdProgress + FlightParameters.swayAmplitude + 0.006);

  flightStartHighRes=performance.now();
  fireImageElement.style.opacity="1";

  requestAnimationFrame(flyingLoop);
}
function switchToCrashed(){
  currentState="crashed";
  stageElement.classList.add("shake");
  setTimeout(()=>stageElement.classList.remove("shake"), 360);
  setTimeout(()=>{ currentState="idle"; StartButtonCooldown.begin(10); }, 280);
}

/* ===== лупы ===== */
function preroundLoop(){
  if (currentState!=="preround") return;
  const elapsed=(performance.now()-preroundStartHighRes)/1000;
  const f=clampValueBetween(elapsed/GlobalConfiguration.preroundSeconds, 0, 1);
  preroundFillElement.style.width=(f*100).toFixed(1)+"%";
  if (f>=1){ switchToFlying(); return; }
  requestAnimationFrame(preroundLoop);
}
function flyingLoop(){
  if (currentState!=="flying") return;

  const now=performance.now();
  const elapsedSecAdj=((now - flightStartHighRes)/1000) * PlaybackController.rate;
  const elapsedMsAdj=(now - flightStartHighRes) * PlaybackController.rate;

  const coeff=coefficientFromElapsedSeconds(elapsedSecAdj);
  coefficientCenterElement.textContent="x"+coeff.toFixed(2);

  const trg=computeTargetProgress(elapsedMsAdj);
  const alpha=trg.isHolding ? FlightParameters.smoothingAlphaDuringHold
                            : FlightParameters.smoothingAlphaDuringBoost;
  const p=smoothedProgress + (trg.target - smoothedProgress)*alpha;
  smoothedProgress=p;

  positionJetAndDecorationsForProgress(p);
  const trail=rebuildTrailUpToProgress(p);

  if (coeff >= currentCrashTarget){
    frozenTrailPathD=trail.d;

    const eps=0.002;
    const p1=clampValueBetween(p-eps, 0, FlightParameters.maximumAllowedProgress);
    const A=getPointForProgress(p1);
    const B=getPointForProgress(p);
    const vx=B.x-A.x, vy=B.y-A.y;
    const len=Math.hypot(vx,vy)||1;
    const ux=vx/len, uy=vy/len;

    const start=B;
    const rot=8 + p*12;
    const t0=performance.now();

    trailPathElement.setAttribute("d", frozenTrailPathD);
    trailGlowElement.setAttribute("d", frozenTrailPathD);

    function exitLoop(){
      const tAdj=(performance.now()-t0)*PlaybackController.rate;
      const speed=360/GlobalConfiguration.exitDurationMilliseconds;
      const ex=start.x + ux*speed*tAdj;
      const ey=start.y + uy*speed*tAdj;

      const jx=ex+6, jy=ey-2;
      luckyJetImageElement.style.transform=`translate(${jx}px, ${jy}px) rotate(${rot}deg)`;

      const jb=luckyJetImageElement.getBoundingClientRect();
      const jw=jb.width || (7.5 * parseFloat(getComputedStyle(stageElement).getPropertyValue('--ui-rem')||'16'));
      const jh=jb.height || jw;
      const anchorX=jx + jw*0.40, anchorY=jy + jh*0.50;

      const radExit=rot*Math.PI/180;
      const dx=Math.cos(radExit), dy=Math.sin(radExit);
      const rightX=dy, rightY=-dx;

      // Fire на вылете — только через CSS-переменные
      const fireX=anchorX + rightX*(jw*FirePlacementSettings.sideFactorFromWidth) - dx*(jw*FirePlacementSettings.backFactorFromWidth);
      const fireY=anchorY + rightY*(jw*FirePlacementSettings.sideFactorFromWidth) - dy*(jw*FirePlacementSettings.backFactorFromWidth) + (jh*FirePlacementSettings.downFactorFromHeight);
      fireImageElement.style.setProperty("--fx", `${fireX}px`);
      fireImageElement.style.setProperty("--fy", `${fireY}px`);
      fireImageElement.style.setProperty("--fa", `${rot + FirePlacementSettings.angleDegreesRelativeToCourse}deg`);

      const lightCenterX=anchorX - dx*(jw*0.32);
      const lightCenterY=anchorY - dy*(jw*0.32);
      const stageW=stageElement.clientWidth;
      const lightSize=Math.max(220, Math.min(360, stageW*0.32));
      lightImageElement.style.width=`${lightSize}px`;
      lightImageElement.style.transform=`translate(${lightCenterX - lightSize/2}px, ${lightCenterY - lightSize/2}px)`;

      if (tAdj < GlobalConfiguration.exitDurationMilliseconds) requestAnimationFrame(exitLoop);
      else switchToCrashed();
    }
    requestAnimationFrame(exitLoop);
    return;
  }

  requestAnimationFrame(flyingLoop);
}

/* ======================== ИНИЦИАЛИЗАЦИЯ / АДАПТАЦИЯ ======================== */

function recomputeLayoutFromStage(){
  const w=stageElement.clientWidth, h=stageElement.clientHeight;
  LayoutSettings.recomputeFromStage(w, h);
}
function rerenderStaticFrame(){
  const progress = typeof smoothedProgress === "number" ? smoothedProgress : 0;
  positionJetAndDecorationsForProgress(progress);
  rebuildTrailUpToProgress(progress);
}
function initialize(){
  currentState="idle";
  ensureLoaderStackLayout();     // привести лоадер к новой адаптивной разметке
  recomputeLayoutFromStage();    // выставить паддинги и --ui-rem
  lightImageElement.style.opacity="0";
  smoothedProgress=0;
  rerenderStaticFrame();

  if (startButtonElement && !startButtonElement.dataset.originalLabel){
    startButtonElement.dataset.originalLabel = startButtonElement.textContent;
  }
  if (startButtonElement){
    startButtonElement.addEventListener("click", function(){
      if (currentState==="idle") switchToPreround();
    });
  }
  if (speedButtonElement){
    speedButtonElement.addEventListener("click", function(){
      PlaybackController.cycleSpeedRate();
    });
  }

  // адаптация при изменении размеров/повороте
  window.addEventListener("resize", function(){
    recomputeLayoutFromStage();
    if (currentState!=="flying") rerenderStaticFrame();
  });
  window.addEventListener("orientationchange", function(){
    setTimeout(function(){
      recomputeLayoutFromStage();
      if (currentState!=="flying") rerenderStaticFrame();
    }, 250);
  });
}
initialize();
