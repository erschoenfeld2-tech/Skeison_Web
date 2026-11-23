// Void-Pionier: eigenes 3D-Modell fuer den Steam-Reiter (site/gaming/3d/void-pionier.glb, gebaut mit tools/void-pionier.py in Blender).
// Wird erst geladen, wenn jemand das Design "Void" waehlt (dynamischer Import aus gaming.js), damit three.js nur bei Bedarf kommt.
// Das Modell hat kein Skelett: die Animationen bewegen die ganze Figur (Schweben, Wippen, Neigen) und lassen die blauen Lichter pulsieren.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function mount(canvas, opt) {
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;

  var scene = new THREE.Scene();
  var pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  var camera = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.05, 50);
  camera.position.set(1.25, 1.35, 4.5);
  var controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.98, 0);
  controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false;
  controls.minPolarAngle = Math.PI * 0.3; controls.maxPolarAngle = Math.PI * 0.6;
  controls.autoRotateSpeed = 1.1;

  // Licht wie auf der Seite: warmes Hauptlicht, blaue Kantenlichter in --accent2
  scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x1c2443, 0.9));
  var key = new THREE.DirectionalLight(0xfff3e8, 2.6); key.position.set(-2, 3, 3); scene.add(key);
  var front = new THREE.DirectionalLight(0xb8c8ff, 0.9); front.position.set(1.5, 1.2, 3); scene.add(front);
  var rim = new THREE.DirectionalLight(0x5b85ff, 2.4); rim.position.set(2.5, 2.5, -2.5); scene.add(rim);
  var rim2 = new THREE.DirectionalLight(0x5b85ff, 1.4); rim2.position.set(-2.5, 1.5, -2); scene.add(rim2);

  var holder = new THREE.Group(); scene.add(holder);
  var glows = [];
  var anim = 'idle', chosen = false, t0 = 0, active = false;
  var clock = new THREE.Clock();
  var calm = function () { return opt.calm() && !chosen; };

  // Bewegungen der ganzen Figur (t = Sekunden seit Beginn der Animation)
  var MOVES = {
    idle: function (t) { holder.position.y = Math.sin(t * 1.6) * 0.01; holder.rotation.set(0, 0, Math.sin(t * 0.8) * 0.012); return 1; },
    walk: function (t) { holder.position.y = Math.abs(Math.sin(t * 4)) * 0.03; holder.rotation.set(0.03, 0, Math.sin(t * 4) * 0.04); return 1; },
    run: function (t) { holder.position.y = Math.abs(Math.sin(t * 7)) * 0.05; holder.rotation.set(0.14, 0, Math.sin(t * 7) * 0.05); return 1.2; },
    build: function (t) {
      var beat = Math.pow(Math.max(0, Math.sin(t * 5)), 12);
      holder.position.y = 0; holder.rotation.set(0.08 - beat * 0.03, Math.sin(t * 0.9) * 0.25, 0); return 1 + beat * 1.5;
    },
    jetpack: function (t) { holder.position.y = 0.09 + Math.sin(t * 2.6) * 0.05; holder.rotation.set(0.1 + Math.sin(t * 2.6) * 0.02, 0, 0); return 1.3 + Math.sin(t * 9) * 0.3; },
    wave: function (t) {
      var k = Math.max(0, 1 - t / 2.4);
      holder.position.y = Math.abs(Math.sin(t * 5)) * 0.04 * k; holder.rotation.set(0, Math.sin(t * 4) * 0.4 * k, 0); return 1 + k * 0.4;
    }
  };

  function frame() {
    var t = clock.getElapsedTime() - t0;
    var glow = 1;
    if (calm()) { holder.position.y = 0; holder.rotation.set(0, 0, 0); }
    else glow = (MOVES[anim] || MOVES.idle)(t);
    glows.forEach(function (g) { g.m.emissiveIntensity = g.base * glow; });
    controls.autoRotate = !opt.calm();
    controls.update();
    renderer.render(scene, camera);
  }
  function setActive(on) {
    if (on === active) return;
    active = on;
    renderer.setAnimationLoop(on ? frame : null);
  }
  function setAnim(name, byUser) {
    anim = name; chosen = !!byUser; t0 = clock.getElapsedTime();
    if (!active) frame();
  }
  document.addEventListener('fx:still', function () { chosen = false; if (!active) frame(); });

  return new Promise(function (resolve, reject) {
    new GLTFLoader().load(opt.url, function (gltf) {
      var model = gltf.scene;
      model.traverse(function (o) {
        if (!o.isMesh) return;
        var m = o.material;
        m.envMapIntensity = 0.8; // Spiegelungen dezent
        if (m.emissive && m.emissive.getHex() !== 0) {
          m.emissiveIntensity = Math.min(m.emissiveIntensity, 2.2);
          glows.push({ m: m, base: m.emissiveIntensity });
        }
      });
      holder.add(model);
      frame();
      canvas.classList.add('ready');
      resolve({ setActive: setActive, setAnim: setAnim });
    }, undefined, reject);
  });
}
