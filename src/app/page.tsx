"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

type ClaySceneProps = {
  brushColor: string;
  brushEnabled: boolean;
  brushSize: number;
  expression: MonsterExpression;
  materialSettings: MonsterAppearance;
  particleStyle: ParticleStyle;
  particleColorVariance: number;
  pressure: number;
  sculptMode: SculptMode;
  initialSnapshot: MonsterSnapshot | null;
  isFinished: boolean;
  onHistoryCommit: () => void;
  resetKey: number;
};

type ClaySceneHandle = {
  focusFront: () => void;
  getSnapshot: () => MonsterSnapshot;
  restoreSnapshot: (snapshot: Pick<MonsterSnapshot, "geometry" | "paintMarks">) => void;
};

type InteractionMode = "orbit" | "sculpt" | "paint" | null;
type MaterialType = "clay" | "glass" | "metal";
type SculptMode = "concave" | "convex";
type EyeStyle = "shine" | "happy" | "sleepy" | "wink" | "lash";
type MouthStyle = "smile" | "open" | "cat" | "tongue" | "sad";
type RoamingMouthStyle = MouthStyle | "wideSmile" | "grin" | "kiss" | "cheer";
type ParticleStyle = "none" | "stars" | "bubbles" | "sprinkles" | "rings" | "cubes";
type ExpressionColorTarget = "eyes" | "mouth";

type MonsterAppearance = {
  color: string;
  materialType: MaterialType;
  textureDataUrl: string | null;
};

type CreatorHistorySnapshot = {
  brushColor: string;
  brushSize: number;
  brushWheelPoint: { x: number; y: number };
  colorApplied: boolean;
  expression: MonsterExpression;
  expressionColorTarget: ExpressionColorTarget;
  eyeHue: number;
  eyeLightness: number;
  eyeSaturation: number;
  eyeWheelPoint: { x: number; y: number };
  geometry: Float32Array | null;
  materialHue: number;
  materialLightness: number;
  materialSaturation: number;
  materialType: MaterialType;
  materialWheelPoint: { x: number; y: number };
  mouthHue: number;
  mouthLightness: number;
  mouthSaturation: number;
  mouthWheelPoint: { x: number; y: number };
  paintMarks: PaintMarkSnapshot[];
  particleColorVariance: number;
  particleStyle: ParticleStyle;
  pressure: number;
  sculptMode: SculptMode;
  textureDataUrl: string | null;
};

type MonsterExpression = {
  eyes: EyeStyle;
  mouth: MouthStyle;
  eyeColor: string;
  mouthColor: string;
};

type PaintMarkSnapshot = {
  color: string;
  normal: [number, number, number];
  position: [number, number, number];
  radius: number;
};

type MonsterSnapshot = {
  geometry: Float32Array | null;
  paintMarks: PaintMarkSnapshot[];
};

const BRUSH_COLORS = [
  "#7652ff",
  "#ff5f8f",
  "#ffb020",
  "#39c76f",
  "#48b8ff",
  "#2d2a32",
];

const DEFAULT_CLAY_COLOR = "#ffffff";
const DEFAULT_PICKER_HUE = 0;
const DEFAULT_PICKER_SATURATION = 78;
const DEFAULT_PICKER_LIGHTNESS = 62;
const DEFAULT_PICKER_WHEEL_POINT = { x: 12, y: 50 };
const DEFAULT_EXPRESSION_HUE = 240;
const DEFAULT_EXPRESSION_SATURATION = 8;
const DEFAULT_EXPRESSION_LIGHTNESS = 15;
const DEFAULT_EXPRESSION_COLOR = hslToCssColor(
  DEFAULT_EXPRESSION_HUE,
  DEFAULT_EXPRESSION_SATURATION,
  DEFAULT_EXPRESSION_LIGHTNESS,
);
const FACE_ANCHOR_SCALE = 1.45;
const FACE_SURFACE_SEARCH_RADIUS = 0.52;
const FACE_SURFACE_OFFSET = 0.055;
const FACE_FEATURE_SCALE = 1.5;
const FACE_FEATURE_DEPTH_SCALE = 0.42;
const FACE_EYE_DEPTH_SCALE = 0.72;
const ROAMING_EYE_DEPTH_SCALE = 0.58;
const ROAMING_SPEECH_DISTANCE = 14;
const ROAMING_SPEECH_DURATION_MS = 30000;
const FACE_ATTACHMENT_OFFSET = -0.018;
const CAT_MOUTH_OFFSET = 0.118;
const HOME_FACE_ATTACHMENT_OFFSET = 0.34;
const HOME_FACE_LAYER_OFFSET = 0.12;
const HOME_LINE_FEATURE_SCALE = 1.55;
const TONGUE_OFFSET_Y = -0.092;
const TONGUE_LINE_OFFSET_Y = -0.106;
const LASH_DIRECTIONS = [
  { x: 0.15, y: 0.13, rotation: 0.72 },
  { x: 0.2, y: 0.05, rotation: 0.34 },
];
const ROAMING_RAINBOW_HUES = [0, 28, 56, 118, 198, 238, 282];

function getRoamingMonsterColor(index: number) {
  const hue = ROAMING_RAINBOW_HUES[index % ROAMING_RAINBOW_HUES.length];
  const hueJitter = (Math.floor(index / ROAMING_RAINBOW_HUES.length) % 3 - 1) * 4;
  const saturation = 0.96 - (index % 2) * 0.04;
  const lightness = 0.68 + (index % 3) * 0.035;

  return new THREE.Color().setHSL(((hue + hueJitter + 360) % 360) / 360, saturation, lightness);
}

function getDistinctHomeMonsterColor(displayIndex: number) {
  const hue = ((displayIndex * 137.508 + seededUnit(displayIndex, 19) * 18) % 360) / 360;
  const saturation = 0.86 + (displayIndex % 4) * 0.03;
  const lightness = 0.64 + (displayIndex % 5) * 0.035;

  return new THREE.Color().setHSL(hue, Math.min(0.98, saturation), Math.min(0.78, lightness));
}

function getDistinctHomeAccentColor(displayIndex: number, salt: number, lightness = 0.54) {
  const hue = (displayIndex * 0.381966 + seededUnit(displayIndex, salt) * 0.22 + salt * 0.017) % 1;

  return new THREE.Color().setHSL(hue, 0.96, lightness);
}

function getHighContrastHomeFaceColor(bodyColor: THREE.Color, index: number, salt: number) {
  const bodyHsl = { h: 0, s: 0, l: 0 };
  bodyColor.getHSL(bodyHsl);

  const hueOffset = 0.48 + seededUnit(index, salt) * 0.1;
  const hue = (bodyHsl.h + hueOffset) % 1;
  const lightness = bodyHsl.l > 0.52 ? 0.24 : 0.78;

  return new THREE.Color().setHSL(hue, 0.98, lightness);
}

function makeHomeFaceFeatureMaterial(color: THREE.Color, feature: "eye" | "mouth") {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.04,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.012,
    envMapIntensity: 1.7,
    transparent: true,
    opacity: feature === "eye" ? 0.96 : 0.94,
    transmission: 0.04,
    thickness: 0.035,
    ior: 1.48,
    emissive: color.clone().multiplyScalar(0.34),
    emissiveIntensity: feature === "eye" ? 0.42 : 0.36,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createHomeParticleGeometry(particleType: number) {
  switch (particleType) {
    case 0:
      return new THREE.TetrahedronGeometry(0.085, 0);
    case 1:
      return new THREE.SphereGeometry(0.067, 14, 10);
    case 2:
      return new THREE.TorusGeometry(0.07, 0.014, 8, 18);
    case 3:
      return new THREE.BoxGeometry(0.09, 0.09, 0.09);
    case 4:
      return new THREE.OctahedronGeometry(0.074, 0);
    case 5:
      return new THREE.CapsuleGeometry(0.028, 0.09, 6, 12);
    default:
      return new THREE.IcosahedronGeometry(0.075, 0);
  }
}

function getHomeMonsterSeed(index: number) {
  if (index === 4) {
    return 315;
  }

  if (index === 6) {
    return 195;
  }

  if (index === 7) {
    return 220;
  }

  if (index === 10) {
    return 360;
  }

  if (index === 12) {
    return 300;
  }

  if (index === 14) {
    return 110;
  }

  if (index === 16) {
    return 60;
  }

  if (index === 17) {
    return 135;
  }

  if (index === 18) {
    return 240;
  }

  if (index === 19) {
    return 365;
  }

  if (index === 21) {
    return 375;
  }

  if (index === 23) {
    return 75;
  }

  if (index === 25) {
    return 165;
  }

  if (index === 28) {
    return 390;
  }

  if (index === 29) {
    return 345;
  }

  if (index === 5) {
    return 210;
  }

  return index;
}

function parseCssColor(color: string) {
  const parsed = new THREE.Color();

  const hslMatch = color.match(
    /hsl\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)/i,
  );

  if (hslMatch) {
    parsed.setHSL(
      Number(hslMatch[1]) / 360,
      Number(hslMatch[2]) / 100,
      Number(hslMatch[3]) / 100,
    );
    return parsed;
  }

  parsed.set(color);
  return parsed;
}

function makeFaceFeatureMaterial(color: string | THREE.Color) {
  const parsedColor = typeof color === "string" ? parseCssColor(color) : color.clone();

  return new THREE.MeshPhysicalMaterial({
    color: parsedColor,
    roughness: 0.03,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.015,
    envMapIntensity: 1.9,
    transparent: true,
    opacity: 0.78,
    transmission: 0.42,
    thickness: 0.28,
    ior: 1.46,
    emissive: parsedColor.clone().multiplyScalar(0.16),
    emissiveIntensity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function makeEyeFeatureMaterial(color: string | THREE.Color) {
  const parsedColor = typeof color === "string" ? parseCssColor(color) : color.clone();

  return new THREE.MeshPhysicalMaterial({
    color: parsedColor,
    roughness: 0.02,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.01,
    envMapIntensity: 2.1,
    transparent: true,
    opacity: 0.58,
    transmission: 0.68,
    thickness: 0.34,
    ior: 1.48,
    emissive: parsedColor.clone().multiplyScalar(0.12),
    emissiveIntensity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function makeFaceDomeGeometry(radius: number, widthSegments = 24, heightSegments = 12) {
  return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
}

function makeTongueGeometry(radius: number, depth = 0.026) {
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);

  for (let index = 1; index <= 20; index += 1) {
    const angle = Math.PI + (Math.PI * index) / 20;
    shape.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }

  shape.lineTo(-radius, 0);

  return new THREE.ExtrudeGeometry(shape, {
    bevelEnabled: true,
    bevelSegments: 5,
    bevelSize: radius * 0.045,
    bevelThickness: depth * 0.28,
    curveSegments: 20,
    depth,
  });
}

function addRoundedArcCaps(mesh: THREE.Mesh, radius: number, tubeRadius: number, arc: number) {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const capGeometry = new THREE.SphereGeometry(tubeRadius * 1.04, 12, 8);
  const startCap = new THREE.Mesh(capGeometry.clone(), material);
  const endCap = new THREE.Mesh(capGeometry, material);

  startCap.position.set(radius, 0, 0);
  endCap.position.set(Math.cos(arc) * radius, Math.sin(arc) * radius, 0);
  startCap.renderOrder = mesh.renderOrder;
  endCap.renderOrder = mesh.renderOrder;
  mesh.add(startCap, endCap);
}

function hslToCssColor(hue: number, saturation: number, lightness: number) {
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function createClayGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1.55, 5);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();

  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);

    const normal = vertex.clone().normalize();
    const wobble =
      Math.sin(normal.x * 6.7 + normal.y * 2.1) * 0.07 +
      Math.cos(normal.z * 7.9 - normal.x * 3.2) * 0.05 +
      Math.sin((normal.x + normal.y + normal.z) * 8.5) * 0.035;

    vertex.multiplyScalar(1 + wobble);
    vertex.x *= 1.08;
    vertex.y *= 0.92;
    vertex.z *= 1.02;
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }

  geometry.computeVertexNormals();
  smoothGeometrySharedNormals(geometry);
  return geometry;
}

function buildNeighborMap(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const neighbors = Array.from({ length: position.count }, () => new Set<number>());
  const index = geometry.index;

  const triangleCount = index ? index.count : position.count;

  for (let item = 0; item < triangleCount; item += 3) {
    const a = index ? index.getX(item) : item;
    const b = index ? index.getX(item + 1) : item + 1;
    const c = index ? index.getX(item + 2) : item + 2;

    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
  }

  for (const group of buildVertexGroups(geometry)) {
    const linked = new Set<number>(group);

    for (const vertexIndex of group) {
      for (const neighbor of neighbors[vertexIndex]) {
        linked.add(neighbor);
      }
    }

    for (const vertexIndex of group) {
      for (const neighbor of linked) {
        if (neighbor !== vertexIndex) {
          neighbors[vertexIndex].add(neighbor);
        }
      }
    }
  }

  return neighbors.map((set) => [...set]);
}

function buildVertexGroups(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const groupsByKey = new Map<string, number[]>();

  for (let index = 0; index < position.count; index += 1) {
    const key = [
      position.getX(index).toFixed(4),
      position.getY(index).toFixed(4),
      position.getZ(index).toFixed(4),
    ].join(",");
    groupsByKey.set(key, [...(groupsByKey.get(key) ?? []), index]);
  }

  return [...groupsByKey.values()].filter((group) => group.length > 1);
}

function smoothGeometrySharedNormals(geometry: THREE.BufferGeometry) {
  const normal = geometry.attributes.normal as THREE.BufferAttribute | undefined;

  if (!normal) {
    return;
  }

  const groups = buildVertexGroups(geometry);
  const average = new THREE.Vector3();

  for (const group of groups) {
    average.set(0, 0, 0);

    for (const vertexIndex of group) {
      average.add(
        new THREE.Vector3(
          normal.getX(vertexIndex),
          normal.getY(vertexIndex),
          normal.getZ(vertexIndex),
        ),
      );
    }

    average.normalize();

    for (const vertexIndex of group) {
      normal.setXYZ(vertexIndex, average.x, average.y, average.z);
    }
  }

  normal.needsUpdate = true;
}

function getCenteredFaceSurfacePoint(
  position: THREE.BufferAttribute,
  direction: THREE.Vector3,
) {
  const targetX = direction.x * FACE_ANCHOR_SCALE;
  const targetY = direction.y * FACE_ANCHOR_SCALE;
  const vertex = new THREE.Vector3();
  let frontZ = -Infinity;

  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);

    const distanceToAnchor = Math.hypot(vertex.x - targetX, vertex.y - targetY);

    if (distanceToAnchor <= FACE_SURFACE_SEARCH_RADIUS) {
      frontZ = Math.max(frontZ, vertex.z);
    }
  }

  if (!Number.isFinite(frontZ)) {
    const fallbackZ = Math.sqrt(
      Math.max(
        0.3,
        FACE_ANCHOR_SCALE * FACE_ANCHOR_SCALE - targetX * targetX - targetY * targetY,
      ),
    );
    frontZ = fallbackZ;
  }

  return new THREE.Vector3(targetX, targetY, frontZ + FACE_SURFACE_OFFSET);
}

function isFaceParticleDirection(direction: THREE.Vector3) {
  return direction.z > 0.48 && direction.y > -0.5 && direction.y < 0.52;
}

function seededUnit(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function makeFaceFeaturesVisible(object: THREE.Object3D, throughBody: boolean) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    child.renderOrder = Math.max(child.renderOrder, 12);
    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((material) => {
      material.depthTest = !throughBody;
      material.depthWrite = false;
      material.transparent = true;
      material.opacity = 1;
      material.needsUpdate = true;
    });
  });
}

function setFaceFeatureOpacity(object: THREE.Object3D, opacity: number) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((material) => {
      material.opacity = opacity;
    });
  });
}

function updateFaceVisibilityThroughBody(
  faceObject: THREE.Object3D,
  bodyObject: THREE.Object3D,
  camera: THREE.Camera,
  throughBody: boolean,
) {
  makeFaceFeaturesVisible(faceObject, throughBody);

  if (!throughBody) {
    setFaceFeatureOpacity(faceObject, 1);
    return;
  }

  const localCamera = bodyObject.worldToLocal(camera.position.clone()).normalize();
  const frontAmount = THREE.MathUtils.clamp((localCamera.z + 0.16) / 0.9, 0, 1);
  const opacity = THREE.MathUtils.lerp(0.32, 1, frontAmount);
  setFaceFeatureOpacity(faceObject, opacity);
}

function makeHomeFaceFeaturesReadable(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    child.renderOrder = Math.max(child.renderOrder, 30);
    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((material) => {
      material.depthTest = false;
      material.depthWrite = false;

      if (material instanceof THREE.MeshPhysicalMaterial) {
        material.transparent = true;
        material.opacity = Math.max(material.opacity, 0.94);
        material.transmission = Math.min(material.transmission, 0.04);
        material.thickness = Math.min(material.thickness, 0.04);
        material.emissive.copy(material.color).multiplyScalar(0.34);
        material.emissiveIntensity = Math.max(material.emissiveIntensity, 0.42);
        material.clearcoat = Math.max(material.clearcoat, 1);
        material.clearcoatRoughness = Math.min(material.clearcoatRoughness, 0.012);
      }

      material.needsUpdate = true;
    });
  });
}

function getPointerPosition(event: PointerEvent, element: HTMLElement) {
  const bounds = element.getBoundingClientRect();

  return new THREE.Vector2(
    ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
    -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
  );
}

function updateCamera(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  yaw: number,
  pitch: number,
  radius: number,
) {
  const clampedPitch = THREE.MathUtils.clamp(pitch, -1.35, 1.35);

  camera.position.set(
    Math.sin(yaw) * Math.cos(clampedPitch) * radius,
    Math.sin(clampedPitch) * radius,
    Math.cos(yaw) * Math.cos(clampedPitch) * radius,
  );
  camera.lookAt(target);
}

function makeClayMaterial(
  appearance: MonsterAppearance,
  texture?: THREE.Texture | null,
) {
  const base = {
    color: parseCssColor(appearance.color),
    map: texture ?? null,
  };

  if (appearance.materialType === "glass") {
    return new THREE.MeshPhysicalMaterial({
      ...base,
      side: THREE.DoubleSide,
      roughness: 0.1,
      transmission: 0.55,
      thickness: 0.55,
      transparent: true,
      opacity: 0.72,
      clearcoat: 0.75,
      clearcoatRoughness: 0.08,
    });
  }

  if (appearance.materialType === "metal") {
    return new THREE.MeshPhysicalMaterial({
      ...base,
      side: THREE.DoubleSide,
      metalness: 0.86,
      roughness: 0.34,
      clearcoat: 0.2,
    });
  }

  const isDefaultClay =
    appearance.color === DEFAULT_CLAY_COLOR ||
    appearance.color.toLowerCase() === "#ffffff" ||
    appearance.color.toLowerCase() === "white";

  return new THREE.MeshPhysicalMaterial({
    ...base,
    color: parseCssColor(isDefaultClay ? "#ffffff" : appearance.color),
    side: THREE.DoubleSide,
    roughness: 0.74,
    clearcoat: 0.03,
    clearcoatRoughness: 0.85,
    sheen: isDefaultClay ? 0 : 0.08,
    sheenColor: new THREE.Color("#ffffff"),
    emissive: isDefaultClay ? new THREE.Color("#ffffff") : new THREE.Color("#000000"),
    emissiveIntensity: isDefaultClay ? 0.22 : 0,
  });
}

function getKoreaSkyColor() {
  const koreaHour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Seoul",
    }).format(new Date()),
  );

  if (koreaHour >= 6 && koreaHour < 17) {
    return "#dff2ff";
  }

  if (koreaHour >= 17 && koreaHour < 20) {
    return "#f2c7b7";
  }

  return "#111827";
}

function getKoreaGroundLightness() {
  const koreaHour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: "Asia/Seoul",
    }).format(new Date()),
  );

  return koreaHour >= 20 || koreaHour < 6 ? 0.78 : 1.08;
}

const ClayScene = forwardRef<ClaySceneHandle, ClaySceneProps>(function ClayScene(
  {
    brushColor,
    brushEnabled,
    brushSize,
    expression,
    materialSettings,
    particleStyle,
    particleColorVariance,
    pressure,
    sculptMode,
    initialSnapshot,
    isFinished,
    onHistoryCommit,
    resetKey,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const onHistoryCommitRef = useRef(onHistoryCommit);
  const brushEnabledRef = useRef(brushEnabled);
  const brushColorRef = useRef(brushColor);
  const brushSizeRef = useRef(brushSize);
  const expressionRef = useRef(expression);
  const materialSettingsRef = useRef(materialSettings);
  const particleStyleRef = useRef(particleStyle);
  const particleColorVarianceRef = useRef(particleColorVariance);
  const pressureRef = useRef(pressure);
  const sculptModeRef = useRef(sculptMode);
  const isFinishedRef = useRef(isFinished);
  const focusFrontActionRef = useRef<() => void>(() => undefined);
  const restoreSnapshotActionRef = useRef<
    (snapshot: Pick<MonsterSnapshot, "geometry" | "paintMarks">) => void
  >(() => undefined);
  const snapshotActionRef = useRef<() => MonsterSnapshot>(() => ({
    geometry: null,
    paintMarks: [],
  }));

  useEffect(() => {
    onHistoryCommitRef.current = onHistoryCommit;
  }, [onHistoryCommit]);

  useImperativeHandle(
    ref,
    () => ({
      focusFront: () => focusFrontActionRef.current(),
      getSnapshot: () => snapshotActionRef.current(),
      restoreSnapshot: (snapshot) => restoreSnapshotActionRef.current(snapshot),
    }),
    [],
  );

  useEffect(() => {
    brushEnabledRef.current = brushEnabled;
    brushColorRef.current = brushColor;
    brushSizeRef.current = brushSize;
    expressionRef.current = expression;
    materialSettingsRef.current = materialSettings;
    particleStyleRef.current = particleStyle;
    particleColorVarianceRef.current = particleColorVariance;
    pressureRef.current = pressure;
    sculptModeRef.current = sculptMode;
    isFinishedRef.current = isFinished;
  }, [
    brushColor,
    brushEnabled,
    brushSize,
    expression,
    materialSettings,
    particleStyle,
    particleColorVariance,
    pressure,
    sculptMode,
    isFinished,
  ]);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return;
    }

    const mountElement = mount;
    const scene = new THREE.Scene();
    const target = new THREE.Vector3(0, 0.05, 0);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
    });
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const localHit = new THREE.Vector3();
    const lastLocalHit = new THREE.Vector3();
    const lastPointer = new THREE.Vector2();
    const lastPaintPoint = new THREE.Vector3(999, 999, 999);
    const sculptQueue = new THREE.Vector3();
    const sculptStep = new THREE.Vector3();

    const orbit = {
      yaw: 0.35,
      pitch: 0.22,
      radius: 8.8,
    };
    const drag = {
      mode: null as InteractionMode,
      pointerId: 0,
    };

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountElement.appendChild(renderer.domElement);

    const monsterGroup = new THREE.Group();
    scene.add(monsterGroup);

    const clayGeometry = createClayGeometry();
    const neighbors = buildNeighborMap(clayGeometry);
    const vertexGroups = buildVertexGroups(clayGeometry);
    const position = clayGeometry.attributes.position as THREE.BufferAttribute;
    const textureLoader = new THREE.TextureLoader();
    let activeTexture: THREE.Texture | null = null;
    let lastMaterialKey = "";
    let lastExpressionKey = "";
    let lastParticleKey = "";
    const paintMarks: PaintMarkSnapshot[] = [];
    let clayMaterial = makeClayMaterial(materialSettingsRef.current);
    const clay = new THREE.Mesh(clayGeometry, clayMaterial);
    clay.castShadow = true;
    clay.receiveShadow = false;
    monsterGroup.add(clay);

    const faceGroup = new THREE.Group();
    clay.add(faceGroup);

    const particleGroup = new THREE.Group();
    clay.add(particleGroup);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.35, 96),
      new THREE.ShadowMaterial({ color: "#5d5148", opacity: 0.18 }),
    );
    floor.position.y = -1.72;
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const ambientLight = new THREE.HemisphereLight("#ffffff", "#ffffff", 1.05);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight("#ffffff", 0.9);
    keyLight.position.set(2.8, 4.6, 3.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#ffffff", 0.65);
    fillLight.position.set(-2.8, 2.2, 4.5);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight("#ffffff", 0.25);
    rimLight.position.set(-3.5, 1.9, -3.2);
    scene.add(rimLight);

    function refreshMaterial() {
      const nextSettings = materialSettingsRef.current;
      lastMaterialKey = JSON.stringify(nextSettings);

      function replaceMaterial(texture: THREE.Texture | null) {
        const previousMaterial = clayMaterial;
        clayMaterial = makeClayMaterial(nextSettings, texture);
        clay.material = clayMaterial;
        previousMaterial.dispose();
      }

      if (!nextSettings.textureDataUrl) {
        activeTexture?.dispose();
        activeTexture = null;
        replaceMaterial(null);
        return;
      }

      textureLoader.load(nextSettings.textureDataUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1.5, 1.5);
        activeTexture?.dispose();
        activeTexture = texture;
        replaceMaterial(texture);
      });
    }

    function clearGroup(group: THREE.Group) {
      for (const child of [...group.children]) {
        group.remove(child);

        child.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose();

            if (Array.isArray(object.material)) {
              object.material.forEach((material) => material.dispose());
            } else {
              object.material.dispose();
            }
          }
        });
      }
    }

    function getSurfacePoint(direction: THREE.Vector3) {
      const normalized = direction.clone().normalize();
      const vertex = new THREE.Vector3();
      const surface = new THREE.Vector3();
      let bestDot = -Infinity;

      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index);
        const dot = vertex.clone().normalize().dot(normalized);

        if (dot > bestDot) {
          bestDot = dot;
          surface.copy(vertex);
        }
      }

      return surface.addScaledVector(normalized, 0.025);
    }

    function placeOnSurface(
      mesh: THREE.Mesh,
      direction: THREE.Vector3,
      scaleX = 1,
      scaleY = 1,
    ) {
      const normal = direction.clone().normalize();
      mesh.position.copy(getSurfacePoint(normal));
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mesh.scale.set(scaleX, scaleY, 1);
      return mesh;
    }

    function placeFaceOnSurface(
      mesh: THREE.Mesh,
      direction: THREE.Vector3,
      scaleX = 1,
      scaleY = 1,
    ) {
      const faceNormal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
      mesh.position.copy(getCenteredFaceSurfacePoint(position, direction));
      mesh.position.addScaledVector(faceNormal, FACE_ATTACHMENT_OFFSET);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceNormal);
      mesh.scale.set(
        scaleX * FACE_FEATURE_SCALE,
        scaleY * FACE_FEATURE_SCALE,
        FACE_FEATURE_DEPTH_SCALE,
      );
      return mesh;
    }

    function addFaceCircle(
      direction: THREE.Vector3,
      scaleX = 1,
      scaleY = 1,
      color = "#242128",
    ) {
      const eye = placeFaceOnSurface(
        new THREE.Mesh(
          makeFaceDomeGeometry(0.13, 28, 14),
          makeFaceFeatureMaterial(color),
        ),
        direction,
        scaleX,
        scaleY,
      );
      eye.scale.z = FACE_FEATURE_DEPTH_SCALE;
      eye.renderOrder = 2;
      faceGroup.add(eye);
    }

    function addFaceEye(
      direction: THREE.Vector3,
      style: EyeStyle,
      side: -1 | 1,
      pupilColor = "#242128",
    ) {
      const faceNormal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
      const closed = style === "sleepy" || style === "happy" || (style === "wink" && side < 0);

      if (closed) {
        const eyeArc = Math.PI;
        const eye = placeFaceOnSurface(
          new THREE.Mesh(
            new THREE.TorusGeometry(0.115, 0.018, 12, 48, eyeArc),
            makeEyeFeatureMaterial(pupilColor),
          ),
          direction,
          style === "sleepy" ? 1.15 : 1.05,
          style === "sleepy" ? 0.58 : 0.72,
        );
        eye.rotation.z = style === "happy" ? 0 : Math.PI;
        addRoundedArcCaps(eye, 0.115, 0.018, eyeArc);
        eye.renderOrder = 2;
        faceGroup.add(eye);
        return;
      }

      const eye = placeFaceOnSurface(
        new THREE.Mesh(
          makeFaceDomeGeometry(style === "lash" ? 0.135 : 0.13, 28, 14),
          makeEyeFeatureMaterial(pupilColor),
        ),
        direction,
        style === "lash" ? 1.05 : 1,
        style === "lash" ? 1.08 : 1,
      );
      eye.renderOrder = 2;
      faceGroup.add(eye);

      const highlight = placeFaceOnSurface(
        new THREE.Mesh(
          makeFaceDomeGeometry(0.036, 16, 8),
          makeEyeFeatureMaterial("#ffffff"),
        ),
        new THREE.Vector3(direction.x - side * 0.035, direction.y + 0.045, direction.z),
        1,
        1,
      );
      highlight.scale.z = FACE_EYE_DEPTH_SCALE;
      highlight.position.addScaledVector(faceNormal, 0.022);
      highlight.renderOrder = 3;
      faceGroup.add(highlight);

      if (style === "lash") {
        LASH_DIRECTIONS.forEach((lashDirection) => {
          const lash = placeFaceOnSurface(
            new THREE.Mesh(
              new THREE.CapsuleGeometry(0.013, 0.104, 6, 12),
              makeEyeFeatureMaterial(pupilColor),
            ),
            new THREE.Vector3(
              direction.x + side * lashDirection.x,
              direction.y + lashDirection.y,
              direction.z,
            ),
            1,
            1,
          );
          lash.rotation.z = side * lashDirection.rotation + Math.PI / 2;
          lash.position.addScaledVector(faceNormal, 0.042);
          lash.renderOrder = 3;
          faceGroup.add(lash);
        });
      }
    }

    function addFaceMouth(direction: THREE.Vector3, mouth: MouthStyle, color: string) {
      if (mouth === "open") {
        addFaceCircle(direction, 0.75, 1.05, color);
        return;
      }

      if (mouth === "cat") {
        const mouthNormal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
        const mouthGroup = new THREE.Group();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(position, direction));
        mouthGroup.position.addScaledVector(mouthNormal, 0.018);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        faceGroup.add(mouthGroup);

        [-CAT_MOUTH_OFFSET, CAT_MOUTH_OFFSET].forEach((offset, index) => {
          const catMouthArc = Math.PI;
          const catMouth = new THREE.Mesh(
            new THREE.TorusGeometry(0.11, 0.022, 12, 44, catMouthArc),
            makeFaceFeatureMaterial(color),
          );
          catMouth.position.x = offset;
          catMouth.scale.y = 0.72;
          catMouth.rotation.z = index === 0 ? Math.PI * 1.08 : Math.PI * 0.92;
          addRoundedArcCaps(catMouth, 0.11, 0.022, catMouthArc);
          catMouth.renderOrder = 2;
          mouthGroup.add(catMouth);
        });
        return;
      }

      if (mouth === "tongue") {
        const tongue = placeFaceOnSurface(
          new THREE.Mesh(
            makeTongueGeometry(0.078),
            makeFaceFeatureMaterial("#ff8fb1"),
          ),
          new THREE.Vector3(direction.x, direction.y + TONGUE_OFFSET_Y, direction.z),
          0.86,
          1.08,
        );
        tongue.renderOrder = 2;
        faceGroup.add(tongue);

        const tongueLine = placeFaceOnSurface(
          new THREE.Mesh(
            new THREE.CapsuleGeometry(0.007, 0.031, 6, 10),
            makeFaceFeatureMaterial("#d85d82"),
          ),
          new THREE.Vector3(direction.x, direction.y + TONGUE_LINE_OFFSET_Y, direction.z),
          1,
          1,
        );
        tongueLine.renderOrder = 3;
        faceGroup.add(tongueLine);

        const smileArc = Math.PI * 0.82;
        const smile = placeFaceOnSurface(
          new THREE.Mesh(
            new THREE.TorusGeometry(0.19, 0.024, 12, 56, smileArc),
            makeFaceFeatureMaterial(color),
          ),
          new THREE.Vector3(direction.x, direction.y + 0.015, direction.z),
          1,
          0.54,
        );
        smile.rotation.z = Math.PI;
        addRoundedArcCaps(smile, 0.19, 0.024, smileArc);
        smile.position.addScaledVector(
          new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize(),
          0.018,
        );
        smile.renderOrder = 4;
        faceGroup.add(smile);
        return;
      }

      const mouthArc = Math.PI;
      const mouthMesh = placeFaceOnSurface(
        new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.026, 12, 60, mouthArc),
          makeFaceFeatureMaterial(color),
        ),
        direction,
        1,
        mouth === "sad" ? 0.55 : 0.58,
      );
      mouthMesh.rotation.z = mouth === "sad" ? 0 : Math.PI;
      addRoundedArcCaps(mouthMesh, 0.24, 0.026, mouthArc);
      mouthMesh.renderOrder = 2;
      faceGroup.add(mouthMesh);
    }

    function addPaintMarkFromSnapshot(markSnapshot: PaintMarkSnapshot) {
      const mark = new THREE.Mesh(
        new THREE.CircleGeometry(markSnapshot.radius, 28),
        new THREE.MeshBasicMaterial({
          color: parseCssColor(markSnapshot.color),
          depthWrite: false,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.92,
        }),
      );
      const localPoint = new THREE.Vector3(...markSnapshot.position);
      const localNormal = new THREE.Vector3(...markSnapshot.normal).normalize();
      mark.position.copy(localPoint).addScaledVector(localNormal, 0.018);
      mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal);
      mark.renderOrder = 1;
      clay.add(mark);
      paintMarks.push({ ...markSnapshot });
    }

    function addPaintAtLocal(localPoint: THREE.Vector3, localNormal: THREE.Vector3) {
      const radius = brushSizeRef.current / 118;
      const color = brushColorRef.current;
      addPaintMarkFromSnapshot({
        color,
        normal: [localNormal.x, localNormal.y, localNormal.z],
        position: [localPoint.x, localPoint.y, localPoint.z],
        radius,
      });
    }

    function addParticle(direction: THREE.Vector3, color: string, shape: ParticleStyle) {
      const geometry =
        shape === "stars"
          ? new THREE.TetrahedronGeometry(0.06, 0)
          : shape === "rings"
            ? new THREE.TorusGeometry(0.07, 0.014, 8, 18)
            : shape === "cubes"
              ? new THREE.BoxGeometry(0.085, 0.085, 0.085)
              : new THREE.SphereGeometry(shape === "bubbles" ? 0.065 : 0.038, 12, 12);
      const particle = placeOnSurface(
        new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color,
            transparent: shape === "bubbles",
            opacity: shape === "bubbles" ? 0.65 : 0.96,
          }),
        ),
        direction,
      );
      particle.rotation.set(
        Math.sin(direction.x * 4.1) * Math.PI,
        Math.cos(direction.y * 3.7) * Math.PI,
        Math.sin(direction.z * 5.3) * Math.PI,
      );
      particle.renderOrder = 3;
      particleGroup.add(particle);
    }

    function getRandomizedParticleColor(baseColor: string, index: number) {
      const variance = particleColorVarianceRef.current;

      if (variance <= 0) {
        return baseColor;
      }

      const hsl = { h: 0, s: 0, l: 0 };
      parseCssColor(baseColor).getHSL(hsl);
      const color = new THREE.Color();
      const hueOffset = ((Math.sin(index * 19.19) + 1) / 2 - 0.5) * variance;
      const saturation = THREE.MathUtils.clamp(hsl.s + variance * 0.35, 0.15, 1);
      const lightWave = Math.sin(index * 8.31 + variance * 4.7) * 0.18 * variance;
      const lightness = THREE.MathUtils.clamp(hsl.l + lightWave, 0.34, 0.76);

      color.setHSL((hsl.h + hueOffset + 1) % 1, saturation, lightness);
      return `#${color.getHexString()}`;
    }

    function refreshExpression() {
      clearGroup(faceGroup);
      const current = expressionRef.current;

      addFaceEye(new THREE.Vector3(-0.34, 0.18, 1), current.eyes, -1, current.eyeColor);
      addFaceEye(new THREE.Vector3(0.34, 0.18, 1), current.eyes, 1, current.eyeColor);

      addFaceMouth(new THREE.Vector3(0, -0.24, 1), current.mouth, current.mouthColor);
      makeFaceFeaturesVisible(faceGroup, materialSettingsRef.current.materialType === "glass");
    }

    function refreshParticles() {
      clearGroup(particleGroup);
      const current = particleStyleRef.current;

      if (current === "none") {
        return;
      }

      const colors =
        current === "stars"
          ? ["#ffcf33", "#fff6a8", "#ff8bb5"]
          : current === "bubbles"
            ? ["#9ce7ff", "#dff8ff", "#bda8ff"]
          : current === "rings"
            ? ["#fff6a8", "#ff8bb5", "#9ce7ff", "#7df5c7"]
          : current === "cubes"
            ? ["#7652ff", "#48b8ff", "#ff9f43", "#39c76f"]
          : ["#7652ff", "#ff5f8f", "#39c76f", "#ffb020"];

      Array.from({ length: current === "sprinkles" ? 38 : current === "rings" ? 22 : 26 }, (_, index) => {
        const angle = index * 1.92;
        const y = -0.85 + ((index * 37) % 170) / 100;
        const direction = new THREE.Vector3(Math.cos(angle), y, Math.sin(angle));

        if (isFaceParticleDirection(direction.clone().normalize())) {
          return;
        }

        addParticle(
          direction,
          getRandomizedParticleColor(colors[index % colors.length], index),
          current,
        );
      });
    }

    function cloneGeometryState() {
      return new Float32Array(position.array as Float32Array);
    }

    function applyGeometryState(snapshot: Float32Array) {
      (position.array as Float32Array).set(snapshot);
      weldSharedVertices();
      position.needsUpdate = true;
      clayGeometry.computeVertexNormals();
      smoothSharedNormals();
    }

    function clearPaintMarks() {
      clay.children
        .filter(
          (child): child is THREE.Mesh =>
            child instanceof THREE.Mesh && child.geometry instanceof THREE.CircleGeometry,
        )
        .forEach((mark) => {
          clay.remove(mark);
          mark.geometry.dispose();
          (mark.material as THREE.Material).dispose();
        });
      paintMarks.length = 0;
    }

    function restoreClaySnapshot(snapshot: Pick<MonsterSnapshot, "geometry" | "paintMarks">) {
      if (snapshot.geometry && snapshot.geometry.length === position.array.length) {
        applyGeometryState(snapshot.geometry);
      }

      clearPaintMarks();
      snapshot.paintMarks.forEach(addPaintMarkFromSnapshot);
    }

    function commitHistoryState() {
      onHistoryCommitRef.current();
    }

    snapshotActionRef.current = () => ({
      geometry: cloneGeometryState(),
      paintMarks: paintMarks.map((mark) => ({ ...mark })),
    });
    restoreSnapshotActionRef.current = restoreClaySnapshot;
    focusFrontActionRef.current = () => {
      orbit.yaw = 0;
      orbit.pitch = 0.12;
      orbit.radius = 8.8;
      updateCamera(camera, target, orbit.yaw, orbit.pitch, orbit.radius);
    };

    if (
      initialSnapshot?.geometry &&
      initialSnapshot.geometry.length === position.array.length
    ) {
      (position.array as Float32Array).set(initialSnapshot.geometry);
      position.needsUpdate = true;
      weldSharedVertices();
      clayGeometry.computeVertexNormals();
      smoothSharedNormals();
      initialSnapshot.paintMarks.forEach(addPaintMarkFromSnapshot);
    }

    function resize() {
      const width = mountElement.clientWidth;
      const height = mountElement.clientHeight;

      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function intersectClay(event: PointerEvent) {
      pointer.copy(getPointerPosition(event, renderer.domElement));
      raycaster.setFromCamera(pointer, camera);

      const [hit] = raycaster.intersectObject(clay, false);
      return hit;
    }

    function paintAt(hit: THREE.Intersection<THREE.Object3D>) {
      const localPoint = hit.point.clone();
      clay.worldToLocal(localPoint);

      const localNormal = hit.face?.normal
        ? hit.face.normal.clone()
        : localPoint.clone().normalize();
      localNormal.normalize();

      const spacing = brushSizeRef.current / 920;

      if (lastPaintPoint.x > 900) {
        addPaintAtLocal(localPoint, localNormal);
        lastPaintPoint.copy(localPoint);
        return;
      }

      const distance = lastPaintPoint.distanceTo(localPoint);
      const steps = Math.max(1, Math.ceil(distance / spacing));

      for (let step = 1; step <= steps; step += 1) {
        const interpolated = lastPaintPoint.clone().lerp(localPoint, step / steps);
        addPaintAtLocal(interpolated, localNormal);
      }

      lastPaintPoint.copy(localPoint);
    }

    function weldSharedVertices() {
      const average = new THREE.Vector3();

      for (const group of vertexGroups) {
        average.set(0, 0, 0);

        for (const vertexIndex of group) {
          average.add(
            new THREE.Vector3(
              position.getX(vertexIndex),
              position.getY(vertexIndex),
              position.getZ(vertexIndex),
            ),
          );
        }

        average.divideScalar(group.length);

        for (const vertexIndex of group) {
          position.setXYZ(vertexIndex, average.x, average.y, average.z);
        }
      }
    }

    function smoothSharedNormals() {
      const normal = clayGeometry.attributes.normal as THREE.BufferAttribute;
      const average = new THREE.Vector3();

      for (const group of vertexGroups) {
        average.set(0, 0, 0);

        for (const vertexIndex of group) {
          average.add(
            new THREE.Vector3(
              normal.getX(vertexIndex),
              normal.getY(vertexIndex),
              normal.getZ(vertexIndex),
            ),
          );
        }

        average.normalize();

        for (const vertexIndex of group) {
          normal.setXYZ(vertexIndex, average.x, average.y, average.z);
        }
      }

      normal.needsUpdate = true;
    }

    function smoothClaySurface(center: THREE.Vector3, radius: number, strength = 0.18) {
      const original = new Float32Array(position.array as Float32Array);
      const vertex = new THREE.Vector3();
      const neighborVertex = new THREE.Vector3();
      const average = new THREE.Vector3();

      for (let pass = 0; pass < 5; pass += 1) {
        for (let index = 0; index < position.count; index += 1) {
          vertex.fromBufferAttribute(position, index);
          const distance = vertex.distanceTo(center);

          if (distance > radius * 1.5) {
            continue;
          }

          average.set(0, 0, 0);

          for (const neighbor of neighbors[index]) {
            neighborVertex.fromBufferAttribute(position, neighbor);
            average.add(neighborVertex);
          }

          if (neighbors[index].length === 0) {
            continue;
          }

          average.divideScalar(neighbors[index].length);

          const influence = Math.pow(1 - distance / (radius * 1.5), 2) * strength;
          vertex.lerp(average, influence);

          const fromOriginal = new THREE.Vector3(
            original[index * 3],
            original[index * 3 + 1],
            original[index * 3 + 2],
          );
          const minRadius = fromOriginal.length() * 0.58;
          const maxRadius = fromOriginal.length() * 1.52;
          const currentRadius = vertex.length();

          if (currentRadius < minRadius || currentRadius > maxRadius) {
            vertex.setLength(THREE.MathUtils.clamp(currentRadius, minRadius, maxRadius));
          }

          position.setXYZ(index, vertex.x, vertex.y, vertex.z);
        }

        weldSharedVertices();
      }
    }

    function sculptAtLocal(center: THREE.Vector3, movement: THREE.Vector3) {
      const vertex = new THREE.Vector3();
      const vertexNormal = new THREE.Vector3();
      const pressureStrength = THREE.MathUtils.lerp(0.65, 1.15, pressureRef.current);
      const sculptRadius = THREE.MathUtils.lerp(0.5, 0.76, pressureRef.current);
      const dampedMove = movement.clone();
      const maxMove = THREE.MathUtils.lerp(0.006, 0.014, pressureRef.current);
      const isConvex = sculptModeRef.current === "convex";

      if (dampedMove.length() > maxMove) {
        dampedMove.setLength(maxMove);
      }

      const moveAmount = dampedMove.length();
      const pressStrength = moveAmount > 0.00001 ? 1 : isConvex ? 0.92 : 1.35;
      const radialSign = isConvex ? 1 : -1;
      const radialDirection = center
        .clone()
        .normalize()
        .multiplyScalar(
          radialSign * (isConvex ? 0.024 + moveAmount * 0.045 : 0.035 + moveAmount * 0.08) * pressureStrength * pressStrength,
        );
      const stretchDirection = dampedMove.clone();

      if (moveAmount > 0.00001) {
        stretchDirection.divideScalar(moveAmount);
      }

      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index);
        const distance = vertex.distanceTo(center);

        if (distance > sculptRadius) {
          continue;
        }

        const distanceRatio = distance / sculptRadius;
        const influence = isConvex
          ? Math.pow(Math.cos(distanceRatio * Math.PI * 0.5), 2.4)
          : Math.pow(1 - distanceRatio, 2);
        const dragStrength = isConvex ? 0.085 : 0.12;
        const stretchStrength = isConvex ? 0.14 : 0.12;
        const dragInfluence = influence * pressureStrength * dragStrength;
        vertex.addScaledVector(dampedMove, dragInfluence);
        vertex.addScaledVector(
          stretchDirection,
          influence * moveAmount * pressureStrength * stretchStrength,
        );
        vertex.addScaledVector(
          isConvex ? vertexNormal.copy(vertex).normalize().multiplyScalar(radialDirection.length()) : radialDirection,
          influence,
        );
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }

      smoothClaySurface(center, sculptRadius, isConvex ? 0.08 : 0.06);
      weldSharedVertices();
      position.needsUpdate = true;
      clayGeometry.computeVertexNormals();
      smoothSharedNormals();
    }

    function queueSculptMovement(movement: THREE.Vector3) {
      sculptQueue.add(movement);

      const maxQueue = THREE.MathUtils.lerp(0.08, 0.14, pressureRef.current);

      if (sculptQueue.length() > maxQueue) {
        sculptQueue.setLength(maxQueue);
      }
    }

    function applyQueuedSculpt() {
      if (sculptQueue.lengthSq() < 0.0000004) {
        sculptAtLocal(lastLocalHit, sculptStep.set(0, 0, 0));
        return;
      }

      const response = THREE.MathUtils.lerp(0.12, 0.18, pressureRef.current);
      sculptStep.copy(sculptQueue).multiplyScalar(response);
      sculptQueue.sub(sculptStep);
      sculptQueue.multiplyScalar(0.9);
      sculptAtLocal(lastLocalHit, sculptStep);
    }

    function sculptAt(currentHit: THREE.Intersection<THREE.Object3D>) {
      localHit.copy(currentHit.point);
      clay.worldToLocal(localHit);

      queueSculptMovement(localHit.clone().sub(lastLocalHit));
      lastLocalHit.copy(localHit);
    }

    function onPointerDown(event: PointerEvent) {
      if (isFinishedRef.current) {
        return;
      }

      renderer.domElement.setPointerCapture(event.pointerId);
      drag.pointerId = event.pointerId;
      lastPointer.copy(pointer.copy(getPointerPosition(event, renderer.domElement)));

      const hit = intersectClay(event);

      if (hit) {
        hit.object.worldToLocal(lastLocalHit.copy(hit.point));
        drag.mode = brushEnabledRef.current ? "paint" : "sculpt";

        if (drag.mode === "paint") {
          lastPaintPoint.set(999, 999, 999);
          commitHistoryState();
          paintAt(hit);
        } else {
          sculptQueue.set(0, 0, 0);
          commitHistoryState();
        }

        return;
      }

      drag.mode = "orbit";
    }

    function onPointerMove(event: PointerEvent) {
      if (isFinishedRef.current) {
        return;
      }

      if (drag.mode === null || drag.pointerId !== event.pointerId) {
        return;
      }

      const currentPointer = getPointerPosition(event, renderer.domElement);
      const delta = currentPointer.clone().sub(lastPointer);

      if (drag.mode === "orbit") {
        orbit.yaw -= delta.x * 2.4;
        orbit.pitch += delta.y * 1.8;
        orbit.pitch = THREE.MathUtils.clamp(orbit.pitch, -1.35, 1.35);
        updateCamera(camera, target, orbit.yaw, orbit.pitch, orbit.radius);
        lastPointer.copy(currentPointer);
        return;
      }

      const hit = intersectClay(event);

      if (!hit) {
        lastPointer.copy(currentPointer);
        return;
      }

      if (drag.mode === "paint") {
        paintAt(hit);
      } else {
        sculptAt(hit);
      }

      lastPointer.copy(currentPointer);
    }

    function onPointerUp(event: PointerEvent) {
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }

      sculptQueue.set(0, 0, 0);
      drag.mode = null;
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      orbit.radius = THREE.MathUtils.clamp(
        orbit.radius + event.deltaY * 0.0032,
        2.6,
        20,
      );
      updateCamera(camera, target, orbit.yaw, orbit.pitch, orbit.radius);
    }

    resize();
    refreshMaterial();
    refreshExpression();
    refreshParticles();
    lastExpressionKey = JSON.stringify(expressionRef.current);
    lastParticleKey = `${particleStyleRef.current}:${particleColorVarianceRef.current}`;
    weldSharedVertices();
    clayGeometry.computeVertexNormals();
    smoothSharedNormals();
    updateCamera(camera, target, orbit.yaw, orbit.pitch, orbit.radius);
    renderer.setAnimationLoop(() => {
      if (lastMaterialKey !== JSON.stringify(materialSettingsRef.current)) {
        refreshMaterial();
      }

      if (lastExpressionKey !== JSON.stringify(expressionRef.current)) {
        refreshExpression();
        lastExpressionKey = JSON.stringify(expressionRef.current);
      }

      const nextParticleKey = `${particleStyleRef.current}:${particleColorVarianceRef.current}`;

      if (lastParticleKey !== nextParticleKey) {
        refreshParticles();
        lastParticleKey = nextParticleKey;
      }

      if (drag.mode === "sculpt" && !isFinishedRef.current) {
        applyQueuedSculpt();
      }

      if (isFinishedRef.current) {
        monsterGroup.rotation.y -= 0.006;
      }

      updateFaceVisibilityThroughBody(
        faceGroup,
        clay,
        camera,
        materialSettingsRef.current.materialType === "glass",
      );
      renderer.render(scene, camera);
    });

    window.addEventListener("resize", resize);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      focusFrontActionRef.current = () => undefined;
      restoreSnapshotActionRef.current = () => undefined;
      snapshotActionRef.current = () => ({ geometry: null, paintMarks: [] });
      activeTexture?.dispose();
      clayGeometry.dispose();
      clayMaterial.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();

          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [initialSnapshot, resetKey]);


  return <div className="three-stage" ref={mountRef} />;
});

function getColorFromWheel(
  event:
    | React.MouseEvent<HTMLButtonElement>
    | React.PointerEvent<HTMLButtonElement>,
) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - bounds.left - bounds.width / 2;
  const y = event.clientY - bounds.top - bounds.height / 2;
  const radius = bounds.width / 2;
  const distance = Math.min(radius, Math.hypot(x, y));
  const angleRadians = Math.atan2(y, x);
  const angle = (angleRadians * 180) / Math.PI + 180;
  const saturation = Math.min(100, (distance / radius) * 100);

  return {
    color: `hsl(${angle.toFixed(0)} ${saturation.toFixed(0)}% 56%)`,
    x: 50 + (Math.cos(angleRadians) * distance * 100) / bounds.width,
    y: 50 + (Math.sin(angleRadians) * distance * 100) / bounds.height,
  };
}

function getHueSaturationFromWheel(
  event:
    | React.MouseEvent<HTMLButtonElement>
    | React.PointerEvent<HTMLButtonElement>,
) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = event.clientX - bounds.left - bounds.width / 2;
  const y = event.clientY - bounds.top - bounds.height / 2;
  const radius = bounds.width / 2;
  const angleRadians = Math.atan2(y, x);

  return {
    hue: Math.round((angleRadians * 180) / Math.PI + 180),
    x: 50 + (Math.cos(angleRadians) * radius * 76) / bounds.width,
    y: 50 + (Math.sin(angleRadians) * radius * 76) / bounds.height,
  };
}

function HomeMonsterDecorations() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mountElement = mountRef.current;

    if (!mountElement) {
      return;
    }

    const stageElement = mountElement;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, 0.1, 80);
    camera.position.set(0, 0.8, 18);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    stageElement.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight("#fff7e8", "#9fb89e", 1.55));

    const keyLight = new THREE.DirectionalLight("#ffffff", 2.7);
    keyLight.position.set(8, 9, 12);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#b9d8ff", 0.75);
    fillLight.position.set(-8, 3, 8);
    scene.add(fillLight);

    function createHomeRoamingMonster(index: number, total: number, displayIndex = index) {
      const group = new THREE.Group();
      group.userData.displayIndex = displayIndex;
      group.userData.seedIndex = index;
      const roamGeometry = createClayGeometry();
      const roamPosition = roamGeometry.attributes.position as THREE.BufferAttribute;
      const color = getDistinctHomeMonsterColor(displayIndex);
      const isTransparentMonster = index % 9 === 1 || index % 9 === 7;
      const isMetalMonster = index % 9 === 2 || index % 9 === 8;
      const body = new THREE.Mesh(
        roamGeometry,
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: isMetalMonster ? 0.48 : 0.56,
          metalness: isMetalMonster ? 0.12 : 0,
          transparent: isTransparentMonster,
          opacity: isTransparentMonster ? 0.88 : 1,
          transmission: 0,
          thickness: isTransparentMonster ? 0.08 : 0,
          clearcoat: isMetalMonster ? 0.22 : 0.04,
          clearcoatRoughness: isMetalMonster ? 0.28 : 0.64,
          depthWrite: !isTransparentMonster,
          emissive: color.clone().multiplyScalar(0.22),
          emissiveIntensity: isTransparentMonster ? 0.56 : 0.42,
        }),
      );
      body.renderOrder = 0;
      const axisA = new THREE.Vector3(
        Math.sin(index * 1.9),
        Math.cos(index * 2.4) * 0.45,
        Math.cos(index * 1.3),
      ).normalize();
      const axisB = new THREE.Vector3(
        Math.cos(index * 2.7),
        Math.sin(index * 1.6),
        Math.sin(index * 2.1),
      ).normalize();

      for (let vertexIndex = 0; vertexIndex < roamPosition.count; vertexIndex += 1) {
        const vertex = new THREE.Vector3().fromBufferAttribute(roamPosition, vertexIndex);
        const normal = vertex.clone().normalize();
        const bulgeA = Math.max(0, normal.dot(axisA));
        const bulgeB = Math.max(0, normal.dot(axisB));
        vertex.multiplyScalar(1 + bulgeA * (0.22 + (index % 4) * 0.06) + bulgeB * 0.16);
        vertex.x *= 0.78 + ((index * 5) % 7) * 0.07;
        vertex.y *= 0.74 + ((index * 3) % 6) * 0.06;
        vertex.z *= 0.82 + ((index * 7) % 5) * 0.08;
        roamPosition.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
      }

      roamPosition.needsUpdate = true;
      roamGeometry.computeVertexNormals();
      smoothGeometrySharedNormals(roamGeometry);
      group.add(body);
      const homeFaceLayer = new THREE.Group();
      homeFaceLayer.position.z = HOME_FACE_LAYER_OFFSET;
      homeFaceLayer.renderOrder = 24;
      group.add(homeFaceLayer);

      const eyeColor = getHighContrastHomeFaceColor(color, displayIndex, 91);
      const mouthColor = getHighContrastHomeFaceColor(color, displayIndex, 137);
      const eyeMaterial = makeHomeFaceFeatureMaterial(eyeColor, "eye");
      const mouthMaterial = makeHomeFaceFeatureMaterial(mouthColor, "mouth");

      function getRoamingSurfacePoint(direction: THREE.Vector3, offset = 0.06) {
        const normal = direction.clone().normalize();
        const vertex = new THREE.Vector3();
        const surface = new THREE.Vector3();
        let bestDot = -Infinity;

        for (let vertexIndex = 0; vertexIndex < roamPosition.count; vertexIndex += 1) {
          vertex.fromBufferAttribute(roamPosition, vertexIndex);
          const dot = vertex.clone().normalize().dot(normal);

          if (dot > bestDot) {
            bestDot = dot;
            surface.copy(vertex);
          }
        }

        return surface.addScaledVector(normal, offset);
      }

      function placeRoamingFace(mesh: THREE.Mesh, direction: THREE.Vector3) {
        const faceNormal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
        mesh.position.copy(getCenteredFaceSurfacePoint(roamPosition, direction));
        mesh.position.addScaledVector(faceNormal, HOME_FACE_ATTACHMENT_OFFSET);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceNormal);
        mesh.renderOrder = 2;
        mesh.scale.multiplyScalar(FACE_FEATURE_SCALE);
        mesh.scale.z *= FACE_FEATURE_DEPTH_SCALE;
        makeHomeFaceFeaturesReadable(mesh);
        homeFaceLayer.add(mesh);
      }

      function createRoamingEye(side: -1 | 1) {
        const eyeStyles: EyeStyle[] = ["shine", "happy", "sleepy", "wink", "lash"];
        const eyeStyle = eyeStyles[index % eyeStyles.length];
        const direction = new THREE.Vector3(side * 0.32, 0.18 + (index % 4) * 0.015, 1);
        const closed = eyeStyle === "sleepy" || eyeStyle === "happy" || (eyeStyle === "wink" && side < 0);

        if (closed) {
          const eyeArc = Math.PI;
          const eye = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.03, 14, 56, eyeArc), eyeMaterial);
          eye.scale.set(eyeStyle === "sleepy" ? 1.15 : 1.05, eyeStyle === "sleepy" ? 0.58 : 0.72, 1);
          eye.rotation.z = eyeStyle === "happy" ? 0 : Math.PI;
          addRoundedArcCaps(eye, 0.115, 0.03, eyeArc);
          placeRoamingFace(eye, direction);
          eye.scale.multiplyScalar(HOME_LINE_FEATURE_SCALE);
          return;
        }

        const eye = new THREE.Mesh(
          makeFaceDomeGeometry(eyeStyle === "lash" ? 0.135 : 0.13, 24, 12),
          eyeMaterial,
        );
        eye.scale.set(eyeStyle === "lash" ? 1.05 : 1, eyeStyle === "lash" ? 1.08 : 1, 1);
        placeRoamingFace(eye, direction);
        eye.scale.z = ROAMING_EYE_DEPTH_SCALE;

        const highlight = new THREE.Mesh(
          makeFaceDomeGeometry(0.036, 16, 8),
          makeEyeFeatureMaterial("#ffffff"),
        );
        placeRoamingFace(
          highlight,
          new THREE.Vector3(direction.x - side * 0.035, direction.y + 0.045, direction.z),
        );
        highlight.scale.z = ROAMING_EYE_DEPTH_SCALE;
        highlight.position.addScaledVector(
          new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize(),
          0.02,
        );
        highlight.renderOrder = 3;

        if (eyeStyle === "lash") {
          LASH_DIRECTIONS.forEach((lashDirection) => {
            const lash = new THREE.Mesh(
              new THREE.CapsuleGeometry(0.013, 0.104, 6, 12),
              eyeMaterial,
            );
            placeRoamingFace(
              lash,
              new THREE.Vector3(
                direction.x + side * lashDirection.x,
                direction.y + lashDirection.y,
                direction.z,
              ),
            );
            lash.position.addScaledVector(
              new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize(),
              0.024,
            );
            lash.rotation.z = side * lashDirection.rotation + Math.PI / 2;
            lash.renderOrder = 3;
          });
        }
      }

      createRoamingEye(-1);
      createRoamingEye(1);

      const mouthStyles: RoamingMouthStyle[] = [
        "smile",
        "wideSmile",
        "open",
        "cat",
        "tongue",
        "grin",
        "kiss",
        "cheer",
        "smile",
        "cat",
      ];
      const mouthStyle = mouthStyles[index % mouthStyles.length];

      if (mouthStyle === "open") {
        const mouth = new THREE.Mesh(makeFaceDomeGeometry(0.12, 24, 12), mouthMaterial);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else if (mouthStyle === "cat") {
        const mouthGroup = new THREE.Group();
        const mouthDirection = new THREE.Vector3(0, -0.27, 1);
        const mouthNormal = new THREE.Vector3(mouthDirection.x * 0.22, mouthDirection.y * 0.22, 1).normalize();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(roamPosition, mouthDirection));
        mouthGroup.position.addScaledVector(mouthNormal, HOME_FACE_ATTACHMENT_OFFSET);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 2;
        homeFaceLayer.add(mouthGroup);

        [-CAT_MOUTH_OFFSET, CAT_MOUTH_OFFSET].forEach((offset, mouthIndex) => {
          const catMouthArc = Math.PI;
          const catMouth = new THREE.Mesh(
            new THREE.TorusGeometry(0.11, 0.022, 12, 44, catMouthArc),
            mouthMaterial,
          );
          catMouth.position.x = offset;
          catMouth.scale.y = 0.72;
          catMouth.rotation.z = mouthIndex === 0 ? Math.PI * 1.08 : Math.PI * 0.92;
          addRoundedArcCaps(catMouth, 0.11, 0.022, catMouthArc);
          catMouth.renderOrder = 2;
          mouthGroup.add(catMouth);
        });
        makeHomeFaceFeaturesReadable(mouthGroup);
      } else if (mouthStyle === "tongue") {
        const mouthGroup = new THREE.Group();
        const mouthDirection = new THREE.Vector3(0, -0.27, 1);
        const mouthNormal = new THREE.Vector3(mouthDirection.x * 0.22, mouthDirection.y * 0.22, 1).normalize();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(roamPosition, mouthDirection));
        mouthGroup.position.addScaledVector(mouthNormal, HOME_FACE_ATTACHMENT_OFFSET);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 4;
        homeFaceLayer.add(mouthGroup);

        const tongue = new THREE.Mesh(
          makeTongueGeometry(0.078),
          makeFaceFeatureMaterial("#ff8fb1"),
        );
        tongue.scale.set(0.86, 1.08, 1);
        tongue.position.y = TONGUE_OFFSET_Y;
        tongue.renderOrder = 2;
        mouthGroup.add(tongue);

        const tongueLine = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.007, 0.031, 6, 10),
          makeFaceFeatureMaterial("#d85d82"),
        );
        tongueLine.position.y = TONGUE_LINE_OFFSET_Y;
        tongueLine.renderOrder = 3;
        mouthGroup.add(tongueLine);

        const smileArc = Math.PI * 0.82;
        const smile = new THREE.Mesh(
          new THREE.TorusGeometry(0.19, 0.024, 12, 56, smileArc),
          mouthMaterial,
        );
        smile.scale.set(1, 0.54, 1);
        smile.rotation.z = Math.PI;
        addRoundedArcCaps(smile, 0.19, 0.024, smileArc);
        smile.position.y = 0.015;
        smile.position.z = 0.012;
        smile.renderOrder = 4;
        mouthGroup.add(smile);
        makeHomeFaceFeaturesReadable(mouthGroup);
      } else if (mouthStyle === "wideSmile") {
        const mouth = new THREE.Mesh(
          new THREE.TorusGeometry(0.29, 0.024, 12, 64, Math.PI * 0.86),
          mouthMaterial,
        );
        addRoundedArcCaps(mouth, 0.29, 0.024, Math.PI * 0.86);
        mouth.rotation.z = Math.PI;
        mouth.scale.y = 0.46;
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else if (mouthStyle === "grin") {
        const mouthGroup = new THREE.Group();
        const mouthDirection = new THREE.Vector3(0, -0.27, 1);
        const mouthNormal = new THREE.Vector3(mouthDirection.x * 0.22, mouthDirection.y * 0.22, 1).normalize();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(roamPosition, mouthDirection));
        mouthGroup.position.addScaledVector(mouthNormal, HOME_FACE_ATTACHMENT_OFFSET);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 4;
        homeFaceLayer.add(mouthGroup);

        const grin = new THREE.Mesh(
          new THREE.CircleGeometry(0.13, 24, 0, Math.PI),
          mouthMaterial,
        );
        grin.scale.set(1.35, 0.62, 1);
        grin.rotation.z = Math.PI;
        mouthGroup.add(grin);

        const tooth = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0175, 0.095, 6, 12),
          makeFaceFeatureMaterial("#ffffff"),
        );
        tooth.rotation.z = Math.PI / 2;
        tooth.position.y = -0.018;
        tooth.position.z = 0.012;
        tooth.renderOrder = 5;
        mouthGroup.add(tooth);
        makeHomeFaceFeaturesReadable(mouthGroup);
      } else if (mouthStyle === "kiss") {
        const mouth = new THREE.Mesh(
          new THREE.TorusGeometry(0.11, 0.026, 16, 44),
          mouthMaterial,
        );
        mouth.scale.set(0.72, 1.05, 1);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else if (mouthStyle === "cheer") {
        const mouth = new THREE.Mesh(
          makeFaceDomeGeometry(0.15, 28, 14),
          mouthMaterial,
        );
        mouth.scale.set(1.15, 0.82, 1);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else {
        const mouth = new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.038, 14, 68, Math.PI),
          mouthMaterial,
        );
        mouth.rotation.z = mouthStyle === "sad" ? 0 : Math.PI;
        mouth.scale.y = mouthStyle === "sad" ? 0.55 : 0.58;
        addRoundedArcCaps(mouth, 0.24, 0.038, Math.PI);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
        mouth.scale.multiplyScalar(HOME_LINE_FEATURE_SCALE);
      }

      Array.from({ length: 3 + (displayIndex % 4) }, (_, markIndex) => {
        const angle = displayIndex * 1.63 + markIndex * 1.91;
        const direction = new THREE.Vector3(
          Math.cos(angle) * 0.75,
          -0.55 + ((markIndex * 41 + displayIndex * 13) % 130) / 100,
          Math.sin(angle) * 0.75,
        ).normalize();
        const mark = new THREE.Mesh(
          new THREE.CircleGeometry(0.1 + ((displayIndex + markIndex) % 3) * 0.038, 24),
          new THREE.MeshBasicMaterial({
            color: getDistinctHomeAccentColor(displayIndex + markIndex * 7, 211 + markIndex, 0.58),
            depthWrite: false,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.9,
          }),
        );
        mark.position.copy(getRoamingSurfacePoint(direction, 0.07));
        mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
        mark.renderOrder = 2;
        body.add(mark);
      });

      Array.from({ length: 6 + (displayIndex % 5) }, (_, particleIndex) => {
        const angle = displayIndex * 0.93 + particleIndex * 2.17;
        const direction = new THREE.Vector3(
          Math.cos(angle),
          -0.4 + ((particleIndex * 31 + displayIndex * 19) % 140) / 100,
          Math.sin(angle),
        ).normalize();

        if (isFaceParticleDirection(direction)) {
          return;
        }

        const particleType = (displayIndex + particleIndex * 2) % 7;
        const particle = new THREE.Mesh(
          createHomeParticleGeometry(particleType),
          new THREE.MeshBasicMaterial({
            color: getDistinctHomeAccentColor(displayIndex + particleIndex * 5, 307 + particleIndex * 13, particleType === 1 ? 0.68 : 0.58),
            transparent: true,
            opacity: particleType === 1 ? 0.66 : 0.93,
          }),
        );
        particle.position.copy(getRoamingSurfacePoint(direction, 0.2 + (particleIndex % 2) * 0.08));
        particle.rotation.set(
          seededUnit(displayIndex + particleIndex, 63) * Math.PI,
          seededUnit(displayIndex + particleIndex, 64) * Math.PI,
          seededUnit(displayIndex + particleIndex, 65) * Math.PI,
        );
        particle.renderOrder = 3;
        body.add(particle);
      });

      const scale = 0.32 + (index % 5) * 0.035;
      group.scale.set(scale * (index % 2 === 0 ? 1.12 : 0.92), scale, scale);
      group.rotation.y = (seededUnit(index, 82) - 0.5) * 0.16;
      group.userData.baseScale = scale;
      group.userData.phase = index * 0.71;
      group.userData.speed = 0.78 + (index % 5) * 0.08;
      group.userData.homeX = 0;
      group.userData.homeY = 0;
      group.userData.homeZ = -0.35 - (index % 5) * 0.08;
      group.userData.xDrift = 0.08 + (index % 4) * 0.018;
      group.userData.yDrift = 0.05 + (index % 3) * 0.014;
      scene.add(group);
      return group;
    }

    const homeMonsters = Array.from({ length: 30 }, (_, index) =>
      createHomeRoamingMonster(getHomeMonsterSeed(index), 30, index),
    );

    function layoutMonsters() {
      const width = stageElement.clientWidth;
      const height = stageElement.clientHeight;
      const aspect = width / Math.max(height, 1);
      const viewHeight = width < 700 ? 13.8 : 9.8;
      const viewWidth = viewHeight * aspect;

      renderer.setSize(width, height);
      camera.left = -viewWidth / 2;
      camera.right = viewWidth / 2;
      camera.top = viewHeight / 2;
      camera.bottom = -viewHeight / 2;
      camera.updateProjectionMatrix();

      const placedMonsters: { radius: number; x: number; y: number }[] = [];
      const xLimit = viewWidth * 0.49;
      const yLimit = viewHeight * 0.51;

      homeMonsters.forEach((monster, index) => {
        const radius = monster.userData.baseScale * (width < 700 ? 2.58 : 2.42) + 0.24;
        let selectedX = 0;
        let selectedY = 0;
        let bestX = 0;
        let bestY = 0;
        let bestGap = -Infinity;

        for (let attempt = 0; attempt < 220; attempt += 1) {
          const x = (seededUnit(index + 1, 31 + attempt * 2) * 2 - 1) * (xLimit - radius);
          const y = (seededUnit(index + 1, 47 + attempt * 2) * 2 - 1) * (yLimit - radius);
          const minGap = placedMonsters.reduce((gap, placed) => {
            const distance = Math.hypot(x - placed.x, y - placed.y);
            return Math.min(gap, distance - radius - placed.radius);
          }, Infinity);

          if (minGap > bestGap) {
            bestGap = minGap;
            bestX = x;
            bestY = y;
          }

          if (minGap >= 0.18) {
            selectedX = x;
            selectedY = y;
            break;
          }
        }

        if (selectedX === 0 && selectedY === 0) {
          selectedX = bestX;
          selectedY = bestY;
        }

        placedMonsters.push({ radius, x: selectedX, y: selectedY });
        monster.userData.homeX = selectedX;
        monster.userData.homeY = selectedY;
        monster.position.set(monster.userData.homeX, monster.userData.homeY, monster.userData.homeZ);
      });
    }

    let animationFrame = 0;

    function animate(time: number) {
      homeMonsters.forEach((monster, index) => {
        const baseScale = monster.userData.baseScale;
        const phase = time * 0.0016 * monster.userData.speed + monster.userData.phase;
        const bounce = Math.abs(Math.sin(time * 0.0052 + index)) * 0.22;

        monster.position.x = monster.userData.homeX + Math.sin(phase) * monster.userData.xDrift;
        monster.position.y = monster.userData.homeY + Math.cos(phase * 1.17) * monster.userData.yDrift;
        monster.rotation.y = Math.sin(phase) * 0.12;
        monster.rotation.z = Math.sin(phase * 0.73) * 0.05;
        monster.scale.y = baseScale * (1 + Math.sin(time * 0.011 + index) * 0.04);
        monster.scale.x = baseScale * (index % 2 === 0 ? 1.12 : 0.92) - (monster.scale.y - baseScale) * 0.28;
        monster.scale.z = baseScale;
        monster.position.z = monster.userData.homeZ + bounce * 0.08;
      });

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    }

    layoutMonsters();
    window.addEventListener("resize", layoutMonsters);
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", layoutMonsters);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();

          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="home-monsters" ref={mountRef} aria-hidden="true" />;
}

function WildSpace({
  appearance,
  expression,
  monsterSnapshot,
  monsterName,
  particleColorVariance,
  particleStyle,
  onBack,
}: {
  appearance: MonsterAppearance;
  expression: MonsterExpression;
  monsterSnapshot: MonsterSnapshot | null;
  monsterName: string;
  particleColorVariance: number;
  particleStyle: ParticleStyle;
  onBack: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const nameTagRef = useRef<HTMLDivElement>(null);
  const speechBubbleRef = useRef<HTMLDivElement>(null);
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const joystickPointerRef = useRef<number | null>(null);
  const [chatText, setChatText] = useState("");
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [photoFlash, setPhotoFlash] = useState(false);
  const [speechText, setSpeechText] = useState("");
  const [showEncyclopedia, setShowEncyclopedia] = useState(false);
  const [showPhotoReview, setShowPhotoReview] = useState(false);
  const [photoReady, setPhotoReady] = useState(false);
  const [joystickOffset, setJoystickOffset] = useState({ x: 0, y: 0 });
  const speechTextRef = useRef("");

  function dispatchWildJoystick(x: number, y: number) {
    window.dispatchEvent(new CustomEvent("wild-joystick-move", { detail: { x, y } }));
  }

  function dispatchWildJump() {
    window.dispatchEvent(new Event("wild-control-jump"));
  }

  function updateJoystickFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const base = joystickBaseRef.current;

    if (!base) {
      return;
    }

    const bounds = base.getBoundingClientRect();
    const radius = bounds.width / 2;
    const maxDistance = radius - 24;
    const rawX = event.clientX - bounds.left - radius;
    const rawY = event.clientY - bounds.top - radius;
    const distance = Math.min(maxDistance, Math.hypot(rawX, rawY));
    const angle = Math.atan2(rawY, rawX);
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    setJoystickOffset({ x, y });
    dispatchWildJoystick(x / maxDistance, -y / maxDistance);
  }

  function resetJoystick() {
    joystickPointerRef.current = null;
    setJoystickOffset({ x: 0, y: 0 });
    dispatchWildJoystick(0, 0);
  }

  useEffect(() => {
    speechTextRef.current = speechText;
  }, [speechText]);

  function saveCapturedPhotoAsJpg() {
    if (!capturedPhoto) {
      return;
    }

    const image = new Image();

    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        return;
      }

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/jpeg", 0.92);
      link.download = `${monsterName || "monster"}.jpg`;
      link.click();
    };

    image.src = capturedPhoto;
  }

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return;
    }

    const mountElement = mount;
    const skyColor = getKoreaSkyColor();
    const isNight = skyColor === "#111827";
    const groundLightness = getKoreaGroundLightness();
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(skyColor, 36, 210);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    const cameraOrbit = {
      yaw: 0.75,
      pitch: 0.58,
      radius: 14,
    };

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(skyColor, 1);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountElement.appendChild(renderer.domElement);

    const geometry = createClayGeometry();
    const position = geometry.attributes.position as THREE.BufferAttribute;

    if (
      monsterSnapshot?.geometry &&
      monsterSnapshot.geometry.length === position.array.length
    ) {
      (position.array as Float32Array).set(monsterSnapshot.geometry);
      position.needsUpdate = true;
      geometry.computeVertexNormals();
      smoothGeometrySharedNormals(geometry);
    }

    const textureLoader = new THREE.TextureLoader();
    const monsterMaterial = makeClayMaterial(appearance);
    let activeTexture: THREE.Texture | null = null;

    if (appearance.textureDataUrl) {
      textureLoader.load(appearance.textureDataUrl, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(1.5, 1.5);
        activeTexture = texture;
        const previousMaterial = monster.material;
        monster.material = makeClayMaterial(appearance, texture);
        previousMaterial.dispose();
      });
    }

    const monster = new THREE.Mesh(geometry, monsterMaterial);
    monster.scale.setScalar(0.42);
    monster.position.y = 0.55;
    monster.castShadow = true;
    monster.receiveShadow = true;
    scene.add(monster);
    const wildFaceGroup = new THREE.Group();
    monster.add(wildFaceGroup);

    function addWildSurfaceCircle(
      direction: THREE.Vector3,
      color: string,
      radius: number,
      scaleX = 1,
      scaleY = 1,
    ) {
      const normal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();

      const mesh = new THREE.Mesh(
        makeFaceDomeGeometry(radius, 24, 12),
        makeFaceFeatureMaterial(color),
      );
      mesh.position.copy(getCenteredFaceSurfacePoint(position, direction));
      mesh.position.addScaledVector(normal, FACE_ATTACHMENT_OFFSET);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mesh.scale.set(
        scaleX * FACE_FEATURE_SCALE,
        scaleY * FACE_FEATURE_SCALE,
        FACE_FEATURE_DEPTH_SCALE,
      );
      mesh.renderOrder = 2;
      wildFaceGroup.add(mesh);
    }

    function addWildEye(
      direction: THREE.Vector3,
      style: EyeStyle,
      side: -1 | 1,
      pupilColor: string,
    ) {
      const normal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
      const surface = getCenteredFaceSurfacePoint(position, direction)
        .addScaledVector(normal, FACE_ATTACHMENT_OFFSET);
      const closed = style === "sleepy" || style === "happy" || (style === "wink" && side < 0);

      if (closed) {
        const eyeArc = Math.PI;
        const eye = new THREE.Mesh(
          new THREE.TorusGeometry(0.115, 0.018, 12, 48, eyeArc),
          makeEyeFeatureMaterial(pupilColor),
        );
        eye.position.copy(surface);
        eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        eye.scale.set(style === "sleepy" ? 1.15 : 1.05, style === "sleepy" ? 0.58 : 0.72, 1);
        eye.scale.multiplyScalar(FACE_FEATURE_SCALE);
        eye.rotation.z = style === "happy" ? 0 : Math.PI;
        addRoundedArcCaps(eye, 0.115, 0.018, eyeArc);
        eye.renderOrder = 2;
        wildFaceGroup.add(eye);
        return;
      }

      const eye = new THREE.Mesh(
        makeFaceDomeGeometry(style === "lash" ? 0.135 : 0.13, 28, 14),
        makeEyeFeatureMaterial(pupilColor),
      );
      eye.position.copy(surface);
      eye.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      eye.scale.set(style === "lash" ? 1.05 : 1, style === "lash" ? 1.08 : 1, 1);
      eye.scale.multiplyScalar(FACE_FEATURE_SCALE);
      eye.scale.z = FACE_EYE_DEPTH_SCALE;
      eye.renderOrder = 2;
      wildFaceGroup.add(eye);

      const highlightSurface = getCenteredFaceSurfacePoint(
        position,
        new THREE.Vector3(direction.x - side * 0.035, direction.y + 0.045, direction.z),
      );
      const highlight = new THREE.Mesh(
        makeFaceDomeGeometry(0.036, 16, 8),
        makeEyeFeatureMaterial("#ffffff"),
      );
      highlight.position.copy(highlightSurface).addScaledVector(normal, 0.022);
      highlight.quaternion.copy(eye.quaternion);
      highlight.scale.setScalar(FACE_FEATURE_SCALE);
      highlight.scale.z = FACE_EYE_DEPTH_SCALE;
      highlight.renderOrder = 3;
      wildFaceGroup.add(highlight);

      if (style === "lash") {
        LASH_DIRECTIONS.forEach((lashDirection) => {
          const lashSurface = getCenteredFaceSurfacePoint(
            position,
            new THREE.Vector3(
              direction.x + side * lashDirection.x,
              direction.y + lashDirection.y,
              direction.z,
            ),
          );
          const lash = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.013, 0.104, 6, 12),
            makeEyeFeatureMaterial(pupilColor),
          );
          lash.position.copy(lashSurface).addScaledVector(normal, 0.042);
          lash.quaternion.copy(eye.quaternion);
          lash.scale.setScalar(FACE_FEATURE_SCALE);
          lash.rotation.z = side * lashDirection.rotation + Math.PI / 2;
          lash.renderOrder = 3;
          wildFaceGroup.add(lash);
        });
      }
    }

    function addWildPaintMark(mark: PaintMarkSnapshot) {
      const localPosition = new THREE.Vector3(...mark.position);
      const localNormal = new THREE.Vector3(...mark.normal).normalize();
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(mark.radius, 28),
        new THREE.MeshBasicMaterial({
          color: parseCssColor(mark.color),
          depthWrite: false,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.92,
        }),
      );
      mesh.position.copy(localPosition).addScaledVector(localNormal, 0.02);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), localNormal);
      mesh.renderOrder = 1;
      monster.add(mesh);
    }

    function addWildMouth(direction: THREE.Vector3) {
      if (expression.mouth === "open") {
        addWildSurfaceCircle(direction, expression.mouthColor, 0.13, 0.75, 1.05);
        return;
      }

      const normal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
      const mouthMaterial = makeFaceFeatureMaterial(expression.mouthColor);

      if (expression.mouth === "cat") {
        const mouthGroup = new THREE.Group();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(position, direction));
        mouthGroup.position.addScaledVector(normal, 0.018);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 2;
        wildFaceGroup.add(mouthGroup);

        [-CAT_MOUTH_OFFSET, CAT_MOUTH_OFFSET].forEach((offset, index) => {
          const catMouthArc = Math.PI;
          const mesh = new THREE.Mesh(
            new THREE.TorusGeometry(0.11, 0.022, 12, 44, catMouthArc),
            mouthMaterial,
          );
          mesh.position.x = offset;
          mesh.rotation.z = index === 0 ? Math.PI * 1.08 : Math.PI * 0.92;
          mesh.scale.set(1, 0.72, 1);
          addRoundedArcCaps(mesh, 0.11, 0.022, catMouthArc);
          mesh.renderOrder = 2;
          mouthGroup.add(mesh);
        });
        return;
      }

      if (expression.mouth === "tongue") {
        const tongue = new THREE.Mesh(
          makeTongueGeometry(0.078),
          makeFaceFeatureMaterial("#ff8fb1"),
        );
        tongue.position.copy(getCenteredFaceSurfacePoint(
          position,
          new THREE.Vector3(direction.x, direction.y + TONGUE_OFFSET_Y, direction.z),
        )).addScaledVector(normal, FACE_ATTACHMENT_OFFSET);
        tongue.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        tongue.scale.set(0.86, 1.08, 1);
        tongue.scale.multiplyScalar(FACE_FEATURE_SCALE);
        tongue.renderOrder = 2;
        wildFaceGroup.add(tongue);

        const tongueLine = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.007, 0.031, 6, 10),
          makeFaceFeatureMaterial("#d85d82"),
        );
        tongueLine.position.copy(getCenteredFaceSurfacePoint(
          position,
          new THREE.Vector3(direction.x, direction.y + TONGUE_LINE_OFFSET_Y, direction.z),
        )).addScaledVector(normal, FACE_ATTACHMENT_OFFSET);
        tongueLine.quaternion.copy(tongue.quaternion);
        tongueLine.scale.setScalar(FACE_FEATURE_SCALE);
        tongueLine.renderOrder = 3;
        wildFaceGroup.add(tongueLine);

        const smileArc = Math.PI * 0.82;
        const smile = new THREE.Mesh(
          new THREE.TorusGeometry(0.19, 0.024, 12, 56, smileArc),
          mouthMaterial,
        );
        smile.position.copy(getCenteredFaceSurfacePoint(
          position,
          new THREE.Vector3(direction.x, direction.y + 0.015, direction.z),
        )).addScaledVector(normal, 0.018);
        smile.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
        smile.rotation.z = Math.PI;
        addRoundedArcCaps(smile, 0.19, 0.024, smileArc);
        smile.scale.set(1, 0.54, 1);
        smile.scale.multiplyScalar(FACE_FEATURE_SCALE);
        smile.renderOrder = 4;
        wildFaceGroup.add(smile);
        return;
      }

      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.24, 0.026, 12, 60, Math.PI),
        mouthMaterial,
      );
      mesh.position.copy(getCenteredFaceSurfacePoint(position, direction));
      mesh.position.addScaledVector(normal, FACE_ATTACHMENT_OFFSET);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mesh.rotation.z = expression.mouth === "sad" ? 0 : Math.PI;
      mesh.scale.set(1, expression.mouth === "sad" ? 0.55 : 0.58, 1);
      mesh.scale.multiplyScalar(FACE_FEATURE_SCALE);
      addRoundedArcCaps(mesh, 0.24, 0.026, Math.PI);
      mesh.renderOrder = 2;
      wildFaceGroup.add(mesh);
    }

    function addWildParticle(direction: THREE.Vector3, color: string, shape: ParticleStyle) {
      const normal = direction.clone().normalize();
      const geometry =
        shape === "stars"
          ? new THREE.TetrahedronGeometry(0.06, 0)
          : shape === "rings"
            ? new THREE.TorusGeometry(0.07, 0.014, 8, 18)
            : shape === "cubes"
              ? new THREE.BoxGeometry(0.085, 0.085, 0.085)
              : new THREE.SphereGeometry(shape === "bubbles" ? 0.065 : 0.038, 12, 12);
      const particle = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: parseCssColor(color),
          transparent: shape === "bubbles",
          opacity: shape === "bubbles" ? 0.65 : 0.96,
        }),
      );
      particle.position.copy(normal.multiplyScalar(1.6));
      particle.rotation.set(
        Math.sin(direction.x * 4.1) * Math.PI,
        Math.cos(direction.y * 3.7) * Math.PI,
        Math.sin(direction.z * 5.3) * Math.PI,
      );
      particle.renderOrder = 3;
      monster.add(particle);
    }

    function randomizedParticleColor(baseColor: string, index: number) {
      if (particleColorVariance <= 0) {
        return baseColor;
      }

      const hsl = { h: 0, s: 0, l: 0 };
      parseCssColor(baseColor).getHSL(hsl);
      const color = new THREE.Color();
      const hueOffset =
        ((Math.sin(index * 19.19) + 1) / 2 - 0.5) * particleColorVariance;
      const saturation = THREE.MathUtils.clamp(
        hsl.s + particleColorVariance * 0.35,
        0.15,
        1,
      );
      const lightness = THREE.MathUtils.clamp(
        hsl.l + Math.sin(index * 8.31) * 0.18 * particleColorVariance,
        0.34,
        0.76,
      );

      color.setHSL((hsl.h + hueOffset + 1) % 1, saturation, lightness);
      return `#${color.getHexString()}`;
    }

    monsterSnapshot?.paintMarks.forEach(addWildPaintMark);

    addWildEye(new THREE.Vector3(-0.34, 0.18, 1), expression.eyes, -1, expression.eyeColor);
    addWildEye(new THREE.Vector3(0.34, 0.18, 1), expression.eyes, 1, expression.eyeColor);
    addWildMouth(new THREE.Vector3(0, -0.24, 1));
    makeFaceFeaturesVisible(wildFaceGroup, appearance.materialType === "glass");

    if (particleStyle !== "none") {
      const particleColors =
        particleStyle === "stars"
          ? ["#ffcf33", "#fff6a8", "#ff8bb5"]
          : particleStyle === "bubbles"
            ? ["#9ce7ff", "#dff8ff", "#bda8ff"]
          : particleStyle === "rings"
            ? ["#fff6a8", "#ff8bb5", "#9ce7ff", "#7df5c7"]
          : particleStyle === "cubes"
            ? ["#7652ff", "#48b8ff", "#ff9f43", "#39c76f"]
            : ["#7652ff", "#ff5f8f", "#39c76f", "#ffb020"];

      Array.from({ length: particleStyle === "sprinkles" ? 38 : particleStyle === "rings" ? 22 : 26 }, (_, index) => {
        const angle = index * 1.92;
        const y = -0.85 + ((index * 37) % 170) / 100;
        const direction = new THREE.Vector3(Math.cos(angle), y, Math.sin(angle));

        if (isFaceParticleDirection(direction.clone().normalize())) {
          return;
        }

        addWildParticle(
          direction,
          randomizedParticleColor(particleColors[index % particleColors.length], index),
          particleStyle,
        );
      });
    }

    function terrainHeight(x: number, z: number) {
      return (
        Math.sin(x * 0.2) * 0.7 +
        Math.cos(z * 0.17) * 0.58 +
        Math.sin((x + z) * 0.07) * 1.15 +
        Math.max(0, 9 - Math.hypot(x - 42, z + 28) * 0.18) +
        Math.max(0, 7 - Math.hypot(x + 56, z - 34) * 0.16) -
        Math.max(0, 1.4 - Math.abs(x + Math.sin(z * 0.04) * 10) * 0.14)
      );
    }

    const groundGeometry = new THREE.PlaneGeometry(520, 520, 180, 180);
    const groundPosition = groundGeometry.attributes.position as THREE.BufferAttribute;

    for (let index = 0; index < groundPosition.count; index += 1) {
      const x = groundPosition.getX(index);
      const y = groundPosition.getY(index);
      groundPosition.setZ(index, terrainHeight(x, -y));
    }

    groundGeometry.computeVertexNormals();

    const ground = new THREE.Mesh(
      groundGeometry,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#abc78f").multiplyScalar(groundLightness),
        roughness: 0.96,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const creekGeometry = new THREE.PlaneGeometry(12, 520, 8, 220);
    const creekPosition = creekGeometry.attributes.position as THREE.BufferAttribute;

    for (let index = 0; index < creekPosition.count; index += 1) {
      const x = creekPosition.getX(index);
      const y = creekPosition.getY(index);
      const bankDip = Math.max(0, 1 - Math.abs(x) / 6) * 0.08;
      creekPosition.setZ(index, terrainHeight(x, -y) + 0.055 - bankDip);
    }

    creekGeometry.computeVertexNormals();

    const creek = new THREE.Mesh(
      creekGeometry,
      new THREE.MeshStandardMaterial({
        color: "#66c7ff",
        metalness: 0.05,
        roughness: 0.25,
        transparent: true,
        opacity: 0.74,
      }),
    );
    creek.rotation.x = -Math.PI / 2;
    scene.add(creek);

    function seededUnit(index: number, salt: number) {
      const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
      return value - Math.floor(value);
    }

    function meadowPoint(index: number, salt = 0) {
      const x = (seededUnit(index, salt) - 0.5) * 150;
      const z = (seededUnit(index, salt + 9.7) - 0.5) * 150;
      return { x, z };
    }

    const matrixHelper = new THREE.Object3D();
    const grassMaterials = ["#4f9a4d", "#6fbf55", "#8dbf62"].map(
      (color) =>
        new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: isNight ? 0.48 : 0.86,
        }),
    );
    grassMaterials.forEach((material, patchIndex) => {
      const grass = new THREE.InstancedMesh(
        new THREE.PlaneGeometry(0.075 + patchIndex * 0.015, 0.54 + patchIndex * 0.08).translate(0, 0.27 + patchIndex * 0.04, 0),
        material,
        5580,
      );
      let placed = 0;

      for (let index = 0; index < 7920 && placed < grass.count; index += 1) {
        const { x, z } = meadowPoint(index + patchIndex * 991, patchIndex * 4.3);

        if (Math.abs(x) < 8 || Math.hypot(x, z) < 7) {
          continue;
        }

        const y = terrainHeight(x, z);
        const heightScale = 0.72 + seededUnit(index, patchIndex + 3) * 0.8;
        matrixHelper.position.set(x, y + 0.025, z);
        matrixHelper.rotation.set(
          (seededUnit(index, patchIndex + 12) - 0.5) * 0.34,
          seededUnit(index, patchIndex + 22) * Math.PI * 2,
          (seededUnit(index, patchIndex + 32) - 0.5) * 0.42,
        );
        matrixHelper.scale.set(0.72 + seededUnit(index, patchIndex + 5) * 0.75, heightScale, 1);
        matrixHelper.updateMatrix();
        grass.setMatrixAt(placed, matrixHelper.matrix);
        placed += 1;
      }

      grass.count = placed;
      scene.add(grass);
    });

    const flowerStem = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.46, 5).translate(0, 0.23, 0),
      new THREE.MeshBasicMaterial({ color: "#3f8f3f", transparent: true, opacity: isNight ? 0.48 : 0.9 }),
      2880,
    );
    const flowerColors = ["#ff6f91", "#ffd166", "#bda8ff", "#ffffff", "#ff9f43"];
    const flowerHeads = flowerColors.map(
      (color) =>
        new THREE.InstancedMesh(
          new THREE.SphereGeometry(0.11, 10, 8),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: isNight ? 0.58 : 0.95 }),
          720,
        ),
    );
    const flowerCounts = flowerHeads.map(() => 0);
    let stemCount = 0;

    for (let index = 0; index < 4680 && stemCount < flowerStem.count; index += 1) {
      const { x, z } = meadowPoint(index + 5011, 17.9);

      if (Math.abs(x) < 9 || Math.hypot(x, z) < 8 || seededUnit(index, 41) < 0.36) {
        continue;
      }

      const y = terrainHeight(x, z);
      const height = 0.72 + seededUnit(index, 18) * 0.55;
      matrixHelper.position.set(x, y + 0.035, z);
      matrixHelper.rotation.set(
        (seededUnit(index, 28) - 0.5) * 0.2,
        seededUnit(index, 29) * Math.PI * 2,
        (seededUnit(index, 30) - 0.5) * 0.18,
      );
      matrixHelper.scale.setScalar(height);
      matrixHelper.updateMatrix();
      flowerStem.setMatrixAt(stemCount, matrixHelper.matrix);

      const flowerIndex = index % flowerHeads.length;
      const head = flowerHeads[flowerIndex];
      const headCount = flowerCounts[flowerIndex];

      if (headCount < head.count) {
        matrixHelper.position.set(x, y + 0.39 * height, z);
        matrixHelper.rotation.set(0, seededUnit(index, 31) * Math.PI * 2, 0);
        matrixHelper.scale.setScalar(0.75 + seededUnit(index, 32) * 0.55);
        matrixHelper.updateMatrix();
        head.setMatrixAt(headCount, matrixHelper.matrix);
        flowerCounts[flowerIndex] += 1;
      }

      stemCount += 1;
    }

    flowerStem.count = stemCount;
    scene.add(flowerStem);
    flowerHeads.forEach((head, index) => {
      head.count = flowerCounts[index];
      scene.add(head);
    });

    const treeMaterial = new THREE.MeshStandardMaterial({ color: "#2f7d45", roughness: 0.9 });
    const darkTreeMaterial = new THREE.MeshStandardMaterial({ color: "#1f5f36", roughness: 0.92 });
    const lightTreeMaterial = new THREE.MeshStandardMaterial({ color: "#4f9a4d", roughness: 0.88 });
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#7a4f32", roughness: 0.95 });
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: isNight ? 0.28 : 0.72,
    });

    Array.from({ length: 900 }, (_, index) => {
      const x = Math.sin(index * 12.989) * (38 + ((index * 37) % 125));
      const z = Math.cos(index * 8.531) * (38 + ((index * 53) % 125));

      if (Math.abs(x) < 12 || Math.hypot(x, z) < 10) {
        return;
      }

      const tree = new THREE.Group();
      const treeType = index % 4;
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(
          treeType === 3 ? 0.12 : 0.18,
          treeType === 3 ? 0.22 : 0.3,
          treeType === 2 ? 1.7 : 1.15,
          8,
        ),
        trunkMaterial,
      );
      const groundY = terrainHeight(x, z);
      trunk.position.y = treeType === 2 ? 0.85 : 0.58;
      trunk.castShadow = true;
      trunk.receiveShadow = true;

      if (treeType === 0) {
        const crown = new THREE.Mesh(new THREE.ConeGeometry(0.95, 2.2, 10), treeMaterial);
        crown.position.y = 2.0;
        crown.castShadow = true;
        crown.receiveShadow = true;
        tree.add(crown);
      } else if (treeType === 1) {
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.9, 14, 12), lightTreeMaterial);
        crown.position.y = 1.85;
        crown.scale.set(1.18, 0.85, 1.05);
        crown.castShadow = true;
        crown.receiveShadow = true;
        tree.add(crown);
      } else if (treeType === 2) {
        const lower = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.55, 9), darkTreeMaterial);
        const upper = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.45, 9), darkTreeMaterial);
        lower.position.y = 1.75;
        upper.position.y = 2.65;
        lower.castShadow = true;
        lower.receiveShadow = true;
        upper.castShadow = true;
        upper.receiveShadow = true;
        tree.add(lower, upper);
      } else {
        const bushA = new THREE.Mesh(new THREE.SphereGeometry(0.58, 12, 10), treeMaterial);
        const bushB = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), lightTreeMaterial);
        bushA.position.set(-0.28, 1.45, 0);
        bushB.position.set(0.34, 1.62, 0.1);
        bushA.castShadow = true;
        bushA.receiveShadow = true;
        bushB.castShadow = true;
        bushB.receiveShadow = true;
        tree.add(bushA, bushB);
      }

      tree.position.set(x, groundY, z);
      tree.rotation.y = index * 0.71;
      tree.scale.setScalar(0.32 + ((index * 17) % 24) / 8);
      tree.add(trunk);
      scene.add(tree);
    });

    const clouds = Array.from({ length: 28 }, (_, index) => {
      const cloud = new THREE.Group();
      const column = index % 7;
      const row = Math.floor(index / 7);
      const baseX = -92 + column * 31 + (seededUnit(index, 52) - 0.5) * 12;
      const baseY = 19 + row * 5.5 + seededUnit(index, 53) * 4.5;
      const baseZ = -48 - row * 22 - seededUnit(index, 54) * 24;

      [
        [-1.35, 0, 0.9],
        [-0.55, 0.35, 1.08],
        [0.25, 0.08, 1.32],
        [1.1, 0.24, 0.92],
      ].forEach(([x, y, scale]) => {
        const puff = new THREE.Mesh(
          new THREE.SphereGeometry(2.8, 16, 10),
          cloudMaterial,
        );
        puff.position.set(x * 3.6, y * 2.1, 0);
        puff.scale.set(scale * 1.75, scale * 0.55, scale * 0.82);
        cloud.add(puff);
      });

      cloud.position.set(baseX, baseY, baseZ);
      cloud.userData.speed = 0.009 + (index % 5) * 0.003;
      scene.add(cloud);
      return cloud;
    });

    function createRoamingMonster(index: number) {
      const group = new THREE.Group();
      const roamGeometry = createClayGeometry();
      const roamPosition = roamGeometry.attributes.position as THREE.BufferAttribute;
      const color = getRoamingMonsterColor(index);
      const isTransparentMonster = index % 9 === 1 || index % 9 === 7;
      const isMetalMonster = index % 9 === 2 || index % 9 === 8;
      const body = new THREE.Mesh(
        roamGeometry,
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: isMetalMonster ? 0.48 : 0.56,
          metalness: isMetalMonster ? 0.12 : 0,
          transparent: isTransparentMonster,
          opacity: isTransparentMonster ? 0.88 : 1,
          transmission: 0,
          thickness: isTransparentMonster ? 0.08 : 0,
          clearcoat: isMetalMonster ? 0.22 : 0.04,
          clearcoatRoughness: isMetalMonster ? 0.28 : 0.64,
          depthWrite: !isTransparentMonster,
          emissive: color.clone().multiplyScalar(0.22),
          emissiveIntensity: isTransparentMonster ? 0.56 : 0.42,
        }),
      );
      const axisA = new THREE.Vector3(
        Math.sin(index * 1.9),
        Math.cos(index * 2.4) * 0.45,
        Math.cos(index * 1.3),
      ).normalize();
      const axisB = new THREE.Vector3(
        Math.cos(index * 2.7),
        Math.sin(index * 1.6),
        Math.sin(index * 2.1),
      ).normalize();

      for (let vertexIndex = 0; vertexIndex < roamPosition.count; vertexIndex += 1) {
        const vertex = new THREE.Vector3().fromBufferAttribute(roamPosition, vertexIndex);
        const normal = vertex.clone().normalize();
        const bulgeA = Math.max(0, normal.dot(axisA));
        const bulgeB = Math.max(0, normal.dot(axisB));
        vertex.multiplyScalar(1 + bulgeA * (0.22 + (index % 4) * 0.06) + bulgeB * 0.16);
        vertex.x *= 0.78 + ((index * 5) % 7) * 0.07;
        vertex.y *= 0.74 + ((index * 3) % 6) * 0.06;
        vertex.z *= 0.82 + ((index * 7) % 5) * 0.08;
        roamPosition.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
      }

      roamPosition.needsUpdate = true;
      roamGeometry.computeVertexNormals();
      smoothGeometrySharedNormals(roamGeometry);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      const eyeColor = new THREE.Color().setHSL((index * 0.19 + 0.58) % 1, 0.74, 0.28);
      const mouthColor = new THREE.Color().setHSL((index * 0.23 + 0.92) % 1, 0.78, 0.34);
      const eyeMaterial = makeEyeFeatureMaterial(eyeColor);
      const mouthMaterial = makeFaceFeatureMaterial(mouthColor);

      function getRoamingSurfacePoint(direction: THREE.Vector3, offset = 0.06) {
        const normal = direction.clone().normalize();
        const vertex = new THREE.Vector3();
        const surface = new THREE.Vector3();
        let bestDot = -Infinity;

        for (let vertexIndex = 0; vertexIndex < roamPosition.count; vertexIndex += 1) {
          vertex.fromBufferAttribute(roamPosition, vertexIndex);
          const dot = vertex.clone().normalize().dot(normal);

          if (dot > bestDot) {
            bestDot = dot;
            surface.copy(vertex);
          }
        }

        return surface.addScaledVector(normal, offset);
      }

      function placeRoamingFace(mesh: THREE.Mesh, direction: THREE.Vector3) {
        const faceNormal = new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize();
        mesh.position.copy(getCenteredFaceSurfacePoint(roamPosition, direction));
        mesh.position.addScaledVector(faceNormal, 0.018);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), faceNormal);
        mesh.renderOrder = 2;
        mesh.scale.multiplyScalar(FACE_FEATURE_SCALE);
        mesh.scale.z *= FACE_FEATURE_DEPTH_SCALE;
        body.add(mesh);
      }

      function createRoamingEye(side: -1 | 1) {
        const eyeStyles: EyeStyle[] = ["shine", "happy", "sleepy", "wink", "lash"];
        const eyeStyle = eyeStyles[index % eyeStyles.length];
        const direction = new THREE.Vector3(side * 0.32, 0.18 + (index % 4) * 0.015, 1);
        const closed = eyeStyle === "sleepy" || eyeStyle === "happy" || (eyeStyle === "wink" && side < 0);

        if (closed) {
          const eyeArc = Math.PI;
          const eye = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.018, 12, 48, eyeArc), eyeMaterial);
          eye.scale.set(eyeStyle === "sleepy" ? 1.15 : 1.05, eyeStyle === "sleepy" ? 0.58 : 0.72, 1);
          eye.rotation.z = eyeStyle === "happy" ? 0 : Math.PI;
          addRoundedArcCaps(eye, 0.115, 0.018, eyeArc);
          placeRoamingFace(eye, direction);
          return;
        }

        const eye = new THREE.Mesh(
          makeFaceDomeGeometry(eyeStyle === "lash" ? 0.135 : 0.13, 24, 12),
          eyeMaterial,
        );
        eye.scale.set(eyeStyle === "lash" ? 1.05 : 1, eyeStyle === "lash" ? 1.08 : 1, 1);
        placeRoamingFace(eye, direction);
        eye.scale.z = ROAMING_EYE_DEPTH_SCALE;

        const highlight = new THREE.Mesh(
          makeFaceDomeGeometry(0.036, 16, 8),
          makeEyeFeatureMaterial("#ffffff"),
        );
        placeRoamingFace(
          highlight,
          new THREE.Vector3(direction.x - side * 0.035, direction.y + 0.045, direction.z),
        );
        highlight.scale.z = ROAMING_EYE_DEPTH_SCALE;
        highlight.position.addScaledVector(
          new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize(),
          0.02,
        );
        highlight.renderOrder = 3;

        if (eyeStyle === "lash") {
          LASH_DIRECTIONS.forEach((lashDirection) => {
            const lash = new THREE.Mesh(
              new THREE.CapsuleGeometry(0.013, 0.104, 6, 12),
              eyeMaterial,
            );
            placeRoamingFace(
              lash,
              new THREE.Vector3(
                direction.x + side * lashDirection.x,
                direction.y + lashDirection.y,
                direction.z,
              ),
            );
            lash.position.addScaledVector(
              new THREE.Vector3(direction.x * 0.22, direction.y * 0.22, 1).normalize(),
              0.024,
            );
            lash.rotation.z = side * lashDirection.rotation + Math.PI / 2;
            lash.renderOrder = 3;
          });
        }
      }

      createRoamingEye(-1);
      createRoamingEye(1);

      const mouthStyles: RoamingMouthStyle[] = [
        "smile",
        "wideSmile",
        "open",
        "cat",
        "tongue",
        "grin",
        "kiss",
        "cheer",
        "smile",
        "cat",
      ];
      const mouthStyle = mouthStyles[index % mouthStyles.length];

      if (mouthStyle === "open") {
        const mouth = new THREE.Mesh(makeFaceDomeGeometry(0.12, 24, 12), mouthMaterial);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else if (mouthStyle === "cat") {
        const mouthGroup = new THREE.Group();
        const mouthDirection = new THREE.Vector3(0, -0.27, 1);
        const mouthNormal = new THREE.Vector3(mouthDirection.x * 0.22, mouthDirection.y * 0.22, 1).normalize();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(roamPosition, mouthDirection));
        mouthGroup.position.addScaledVector(mouthNormal, 0.04);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 2;
        body.add(mouthGroup);

        [-CAT_MOUTH_OFFSET, CAT_MOUTH_OFFSET].forEach((offset, mouthIndex) => {
          const catMouthArc = Math.PI;
          const catMouth = new THREE.Mesh(
            new THREE.TorusGeometry(0.11, 0.022, 12, 44, catMouthArc),
            mouthMaterial,
          );
          catMouth.position.x = offset;
          catMouth.scale.y = 0.72;
          catMouth.rotation.z = mouthIndex === 0 ? Math.PI * 1.08 : Math.PI * 0.92;
          addRoundedArcCaps(catMouth, 0.11, 0.022, catMouthArc);
          catMouth.renderOrder = 2;
          mouthGroup.add(catMouth);
        });
      } else if (mouthStyle === "tongue") {
        const mouthGroup = new THREE.Group();
        const mouthDirection = new THREE.Vector3(0, -0.27, 1);
        const mouthNormal = new THREE.Vector3(mouthDirection.x * 0.22, mouthDirection.y * 0.22, 1).normalize();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(roamPosition, mouthDirection));
        mouthGroup.position.addScaledVector(mouthNormal, 0.04);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 4;
        body.add(mouthGroup);

        const tongue = new THREE.Mesh(
          makeTongueGeometry(0.078),
          makeFaceFeatureMaterial("#ff8fb1"),
        );
        tongue.scale.set(0.86, 1.08, 1);
        tongue.position.y = TONGUE_OFFSET_Y;
        tongue.renderOrder = 2;
        mouthGroup.add(tongue);

        const tongueLine = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.007, 0.031, 6, 10),
          makeFaceFeatureMaterial("#d85d82"),
        );
        tongueLine.position.y = TONGUE_LINE_OFFSET_Y;
        tongueLine.renderOrder = 3;
        mouthGroup.add(tongueLine);

        const smileArc = Math.PI * 0.82;
        const smile = new THREE.Mesh(
          new THREE.TorusGeometry(0.19, 0.024, 12, 56, smileArc),
          mouthMaterial,
        );
        smile.scale.set(1, 0.54, 1);
        smile.rotation.z = Math.PI;
        addRoundedArcCaps(smile, 0.19, 0.024, smileArc);
        smile.position.y = 0.015;
        smile.position.z = 0.012;
        smile.renderOrder = 4;
        mouthGroup.add(smile);
      } else if (mouthStyle === "wideSmile") {
        const mouth = new THREE.Mesh(
          new THREE.TorusGeometry(0.29, 0.024, 12, 64, Math.PI * 0.86),
          mouthMaterial,
        );
        addRoundedArcCaps(mouth, 0.29, 0.024, Math.PI * 0.86);
        mouth.rotation.z = Math.PI;
        mouth.scale.y = 0.46;
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else if (mouthStyle === "grin") {
        const mouthGroup = new THREE.Group();
        const mouthDirection = new THREE.Vector3(0, -0.27, 1);
        const mouthNormal = new THREE.Vector3(mouthDirection.x * 0.22, mouthDirection.y * 0.22, 1).normalize();
        mouthGroup.position.copy(getCenteredFaceSurfacePoint(roamPosition, mouthDirection));
        mouthGroup.position.addScaledVector(mouthNormal, 0.04);
        mouthGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), mouthNormal);
        mouthGroup.scale.setScalar(FACE_FEATURE_SCALE);
        mouthGroup.renderOrder = 4;
        body.add(mouthGroup);

        const grin = new THREE.Mesh(
          new THREE.CircleGeometry(0.13, 24, 0, Math.PI),
          mouthMaterial,
        );
        grin.scale.set(1.35, 0.62, 1);
        grin.rotation.z = Math.PI;
        mouthGroup.add(grin);

        const tooth = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.0175, 0.095, 6, 12),
          makeFaceFeatureMaterial("#ffffff"),
        );
        tooth.rotation.z = Math.PI / 2;
        tooth.position.y = -0.018;
        tooth.position.z = 0.012;
        tooth.renderOrder = 5;
        mouthGroup.add(tooth);
      } else if (mouthStyle === "kiss") {
        const mouth = new THREE.Mesh(
          new THREE.TorusGeometry(0.11, 0.026, 16, 44),
          mouthMaterial,
        );
        mouth.scale.set(0.72, 1.05, 1);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else if (mouthStyle === "cheer") {
        const mouth = new THREE.Mesh(
          makeFaceDomeGeometry(0.15, 28, 14),
          mouthMaterial,
        );
        mouth.scale.set(1.15, 0.82, 1);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      } else {
        const mouth = new THREE.Mesh(
          new THREE.TorusGeometry(0.24, 0.026, 12, 60, Math.PI),
          mouthMaterial,
        );
        mouth.rotation.z = mouthStyle === "sad" ? 0 : Math.PI;
        mouth.scale.y = mouthStyle === "sad" ? 0.55 : 0.58;
        addRoundedArcCaps(mouth, 0.24, 0.026, Math.PI);
        placeRoamingFace(mouth, new THREE.Vector3(0, -0.27, 1));
      }

      if (index % 3 === 0 || index % 5 === 0) {
        const paintPalette = ["#ff6f91", "#48b8ff", "#ffd166", "#bda8ff", "#39c76f"];

        Array.from({ length: 4 + (index % 4) }, (_, markIndex) => {
          const angle = index * 1.3 + markIndex * 1.74;
          const direction = new THREE.Vector3(
            Math.cos(angle) * 0.75,
            -0.55 + ((markIndex * 37 + index * 11) % 130) / 100,
            Math.sin(angle) * 0.75,
          ).normalize();
          const mark = new THREE.Mesh(
            new THREE.CircleGeometry(0.12 + (markIndex % 3) * 0.035, 24),
            new THREE.MeshBasicMaterial({
              color: paintPalette[(index + markIndex) % paintPalette.length],
              depthWrite: false,
              side: THREE.DoubleSide,
              transparent: true,
              opacity: 0.9,
            }),
          );
          mark.position.copy(getRoamingSurfacePoint(direction, 0.07));
          mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
          mark.renderOrder = 2;
          body.add(mark);
        });
      }

      if (index % 4 === 0 || index % 7 === 0) {
        const particlePalette = [
          "#fff6a8",
          "#ff8bb5",
          "#9ce7ff",
          "#ffffff",
          "#bda8ff",
          "#7df5c7",
          "#ffcf8c",
          "#d7ff72",
          "#ff7ad9",
        ];

        Array.from({ length: 7 + (index % 5) }, (_, particleIndex) => {
          const angle = index * 0.8 + particleIndex * 2.1;
          const direction = new THREE.Vector3(
            Math.cos(angle),
            -0.4 + ((particleIndex * 29 + index * 17) % 140) / 100,
            Math.sin(angle),
          ).normalize();

          if (isFaceParticleDirection(direction)) {
            return;
          }

          const particleType = (index + particleIndex) % 5;
          const particle = new THREE.Mesh(
            particleType === 0
              ? new THREE.TetrahedronGeometry(0.085, 0)
              : particleType === 1
                ? new THREE.SphereGeometry(0.065, 12, 8)
                : particleType === 2
                  ? new THREE.TorusGeometry(0.07, 0.014, 8, 18)
                  : particleType === 3
                    ? new THREE.BoxGeometry(0.09, 0.09, 0.09)
                    : new THREE.OctahedronGeometry(0.07, 0),
            new THREE.MeshBasicMaterial({
              color: particlePalette[(index + particleIndex) % particlePalette.length],
              transparent: true,
              opacity: particleType === 1 ? 0.62 : 0.92,
            }),
          );
          particle.position.copy(getRoamingSurfacePoint(direction, 0.2 + (particleIndex % 2) * 0.08));
          particle.rotation.set(
            seededUnit(index + particleIndex, 63) * Math.PI,
            seededUnit(index + particleIndex, 64) * Math.PI,
            seededUnit(index + particleIndex, 65) * Math.PI,
          );
          particle.renderOrder = 3;
          body.add(particle);
        });
      }

      const angle = index * 2.399;
      const distance = 16 + (index % 6) * 6;
      const centerX = Math.cos(angle) * distance + (index % 3 - 1) * 12;
      const centerZ = Math.sin(angle) * distance + (((index + 1) % 3) - 1) * 10;
      const scale = 0.28 + (index % 5) * 0.035;
      group.scale.set(scale * (index % 2 === 0 ? 1.12 : 0.92), scale, scale);
      group.position.set(centerX, terrainHeight(centerX, centerZ) + scale * 1.32, centerZ);
      group.rotation.y = angle + Math.PI;
      group.userData.centerX = centerX;
      group.userData.centerZ = centerZ;
      group.userData.radius = 2.8 + (index % 4) * 1.3;
      group.userData.phase = index * 0.71;
      group.userData.speed = 0.28 + (index % 5) * 0.05;
      group.userData.baseScale = scale;
      scene.add(group);
      return group;
    }

    const roamingMonsters = Array.from({ length: 36 }, (_, index) =>
      createRoamingMonster(index),
    );
    const roamingSpeechMessages = [
      "몬스터 여러분 멋지십니다!",
      "난 역시 몬스터야 킥킥",
      "몬스터를 좋아하세요...",
      "우효!",
      "몬크크",
      "안녕!",
    ];

    function drawSpeechBubblePath(
      context: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
    ) {
      context.beginPath();
      context.moveTo(x + radius, y);
      context.lineTo(x + width - radius, y);
      context.quadraticCurveTo(x + width, y, x + width, y + radius);
      context.lineTo(x + width, y + height - radius);
      context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      context.lineTo(x + radius, y + height);
      context.quadraticCurveTo(x, y + height, x, y + height - radius);
      context.lineTo(x, y + radius);
      context.quadraticCurveTo(x, y, x + radius, y);
      context.closePath();
    }

    function createRoamingSpeechSprite(text: string) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      const fontSize = 38;
      const paddingX = 44;
      const bubbleHeight = 104;
      const height = 168;
      let width = 280;

      if (context) {
        context.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
        width = Math.ceil(
          THREE.MathUtils.clamp(context.measureText(text).width + paddingX * 2 + 68, 260, 720),
        );
      }

      canvas.width = width;
      canvas.height = height;

      if (context) {
        context.clearRect(0, 0, width, height);
        context.shadowColor = "rgba(54, 46, 40, 0.16)";
        context.shadowBlur = 22;
        context.shadowOffsetY = 10;
        context.fillStyle = "rgba(255, 255, 255, 0.86)";
        drawSpeechBubblePath(context, 34, 30, width - 68, bubbleHeight, bubbleHeight / 2);
        context.fill();
        context.shadowColor = "transparent";
        context.fillStyle = "rgba(36, 29, 24, 0.86)";
        context.font = `900 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(text, width / 2, 82);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: texture,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      );
      sprite.scale.set(width * 0.0084, 1.44, 1);
      sprite.renderOrder = 8;
      sprite.visible = false;
      scene.add(sprite);
      return sprite;
    }

    function disposeRoamingSpeechSprite(sprite: THREE.Sprite) {
      scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }

    const shuffledSpeechMessages = [...roamingSpeechMessages].sort(
      (first, second) =>
        seededUnit(first.length, 71.3) - seededUnit(second.length, 71.3),
    );
    let nextRoamingSpeechMessageIndex = 0;

    function takeNextRoamingSpeechMessage() {
      const message =
        shuffledSpeechMessages[
          nextRoamingSpeechMessageIndex % shuffledSpeechMessages.length
        ];
      nextRoamingSpeechMessageIndex += 1;
      return message;
    }

    function triggerRoamingSpeech(roamingMonster: THREE.Group, time: number) {
      const existingSprite = roamingMonster.userData.speechSprite as
        | THREE.Sprite
        | undefined;
      if (existingSprite) {
        disposeRoamingSpeechSprite(existingSprite);
      }
      roamingMonster.userData.speechSprite = createRoamingSpeechSprite(
        takeNextRoamingSpeechMessage(),
      );
      roamingMonster.userData.speechExpiresAt = time + ROAMING_SPEECH_DURATION_MS;
    }

    scene.add(new THREE.AmbientLight("#fff6e8", 0.28 * groundLightness));
    scene.add(new THREE.HemisphereLight("#fff8e8", "#8da67e", 0.72 * groundLightness));

    const keyLight = new THREE.DirectionalLight("#fff2d8", 2.65 * groundLightness);
    keyLight.position.set(16, 22, 11);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(4096, 4096);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 90;
    keyLight.shadow.camera.left = -45;
    keyLight.shadow.camera.right = 45;
    keyLight.shadow.camera.top = 45;
    keyLight.shadow.camera.bottom = -45;
    keyLight.shadow.bias = -0.00045;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight("#b9d6ff", 0.46 * groundLightness);
    fillLight.position.set(-14, 6, -10);
    scene.add(fillLight);

    const pressedKeys = new Set<string>();
    const velocity = new THREE.Vector3();
    const joystickVector = new THREE.Vector2();
    const cameraDrag = {
      active: false,
      x: 0,
      y: 0,
    };
    let jumpVelocity = 0;
    let isGrounded = true;
    let animationFrame = 0;
    let previousTime = performance.now();

    function resize() {
      const width = mountElement.clientWidth;
      const height = mountElement.clientHeight;

      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function updateWildCamera() {
      const target = monster.position.clone();
      target.y = monster.userData.cameraTargetY ?? target.y;
      target.y += 0.8;
      cameraOrbit.pitch = THREE.MathUtils.clamp(cameraOrbit.pitch, 0.16, 1.25);
      camera.position.set(
        target.x + Math.sin(cameraOrbit.yaw) * Math.cos(cameraOrbit.pitch) * cameraOrbit.radius,
        target.y + Math.sin(cameraOrbit.pitch) * cameraOrbit.radius,
        target.z + Math.cos(cameraOrbit.yaw) * Math.cos(cameraOrbit.pitch) * cameraOrbit.radius,
      );

      const groundBelow = terrainHeight(camera.position.x, camera.position.z) + 0.8;

      if (camera.position.y < groundBelow) {
        camera.position.y = groundBelow;
      }

      camera.lookAt(target);
    }

    function jumpMonster() {
      if (!isGrounded) {
        return;
      }

      jumpVelocity = 4.8;
      isGrounded = false;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(
          event.key,
        )
      ) {
        event.preventDefault();
      }

      if (event.key === " ") {
        jumpMonster();
        return;
      }

      pressedKeys.add(event.key);
    }

    function onKeyUp(event: KeyboardEvent) {
      pressedKeys.delete(event.key);
    }

    function onJoystickMove(event: Event) {
      const detail = (event as CustomEvent<{ x?: number; y?: number }>).detail;
      joystickVector.set(
        THREE.MathUtils.clamp(Number(detail?.x) || 0, -1, 1),
        THREE.MathUtils.clamp(Number(detail?.y) || 0, -1, 1),
      );
    }

    function onPointerDown(event: PointerEvent) {
      cameraDrag.active = true;
      cameraDrag.x = event.clientX;
      cameraDrag.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (!cameraDrag.active) {
        return;
      }

      const deltaX = event.clientX - cameraDrag.x;
      const deltaY = event.clientY - cameraDrag.y;
      cameraOrbit.yaw -= deltaX * 0.006;
      cameraOrbit.pitch += deltaY * 0.004;
      cameraDrag.x = event.clientX;
      cameraDrag.y = event.clientY;
    }

    function onPointerUp(event: PointerEvent) {
      cameraDrag.active = false;

      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      cameraOrbit.radius = THREE.MathUtils.clamp(
        cameraOrbit.radius + event.deltaY * 0.01,
        5,
        34,
      );
    }

    function onPhotoFocus() {
      cameraOrbit.yaw = monster.rotation.y;
      cameraOrbit.pitch = 0.22;
      cameraOrbit.radius = 4.8;
      updateWildCamera();
      setPhotoReady(true);
    }

    function drawRoundedRect(
      context: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
      radius: number,
    ) {
      context.beginPath();
      context.moveTo(x + radius, y);
      context.lineTo(x + width - radius, y);
      context.quadraticCurveTo(x + width, y, x + width, y + radius);
      context.lineTo(x + width, y + height - radius);
      context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
      context.lineTo(x + radius, y + height);
      context.quadraticCurveTo(x, y + height, x, y + height - radius);
      context.lineTo(x, y + radius);
      context.quadraticCurveTo(x, y, x + radius, y);
      context.closePath();
    }

    function wrapCanvasText(
      context: CanvasRenderingContext2D,
      text: string,
      maxWidth: number,
    ) {
      const lines: string[] = [];
      let currentLine = "";

      for (const character of text) {
        const nextLine = currentLine + character;

        if (currentLine && context.measureText(nextLine).width > maxWidth) {
          lines.push(currentLine);
          currentLine = character;
        } else {
          currentLine = nextLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    }

    function capturePhotoWithOverlay() {
      const sourceCanvas = renderer.domElement;
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        return sourceCanvas.toDataURL("image/png");
      }

      canvas.width = sourceCanvas.width;
      canvas.height = sourceCanvas.height;
      context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);

      const overlayScale = canvas.width / Math.max(mountElement.clientWidth, 1);
      const headPosition = monster.position.clone();
      headPosition.y += 1.02;
      headPosition.project(camera);

      const x = (headPosition.x * 0.5 + 0.5) * canvas.width;
      const y = (-headPosition.y * 0.5 + 0.5) * canvas.height;
      const displayName = monsterName || "이름 없는 몬스터";
      const speech = speechTextRef.current.trim();

      context.save();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.shadowColor = "rgba(0, 0, 0, 0.55)";
      context.shadowBlur = 8 * overlayScale;
      context.shadowOffsetY = 2 * overlayScale;
      context.fillStyle = "#ffffff";
      context.font = `900 ${18 * overlayScale}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
      context.fillText(displayName, x, y - 16 * overlayScale);
      context.restore();

      if (speech) {
        context.save();
        context.font = `900 ${16 * overlayScale}px system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
        const paddingX = 14 * overlayScale;
        const paddingY = 10 * overlayScale;
        const lineHeight = 21 * overlayScale;
        const maxTextWidth = Math.min(320 * overlayScale, canvas.width - 72 * overlayScale);
        const lines = wrapCanvasText(context, speech, maxTextWidth).slice(0, 3);
        const textWidth = Math.min(
          maxTextWidth,
          Math.max(...lines.map((line) => context.measureText(line).width)),
        );
        const bubbleWidth = textWidth + paddingX * 2;
        const bubbleHeight = lines.length * lineHeight + paddingY * 2;
        const bubbleX = THREE.MathUtils.clamp(
          x - bubbleWidth / 2,
          18 * overlayScale,
          canvas.width - bubbleWidth - 18 * overlayScale,
        );
        const bubbleY = Math.max(18 * overlayScale, y - bubbleHeight - 54 * overlayScale);

        context.fillStyle = "rgba(255, 255, 255, 0.9)";
        context.shadowColor = "rgba(54, 46, 40, 0.18)";
        context.shadowBlur = 18 * overlayScale;
        drawRoundedRect(context, bubbleX, bubbleY, bubbleWidth, bubbleHeight, 18 * overlayScale);
        context.fill();
        context.shadowColor = "transparent";
        context.fillStyle = "rgba(36, 29, 24, 0.86)";
        context.textAlign = "center";
        context.textBaseline = "middle";
        lines.forEach((line, index) => {
          context.fillText(
            line,
            bubbleX + bubbleWidth / 2,
            bubbleY + paddingY + lineHeight * (index + 0.5),
          );
        });
        context.restore();
      }

      return canvas.toDataURL("image/png");
    }

    function onPhotoCapture() {
      setPhotoFlash(true);
      onPhotoFocus();

      window.setTimeout(() => {
        renderer.render(scene, camera);
        setCapturedPhoto(capturePhotoWithOverlay());
        setShowPhotoReview(true);
        setPhotoFlash(false);
      }, 220);
    }

    function updateMonsterOverlayPosition() {
      const headPosition = monster.position.clone();
      headPosition.y += 1.02;
      headPosition.project(camera);

      const x = (headPosition.x * 0.5 + 0.5) * mountElement.clientWidth;
      const y = (-headPosition.y * 0.5 + 0.5) * mountElement.clientHeight;

      if (nameTagRef.current) {
        nameTagRef.current.style.left = `${x}px`;
        nameTagRef.current.style.top = `${y}px`;
      }

      if (speechBubbleRef.current) {
        speechBubbleRef.current.style.left = `${x}px`;
        speechBubbleRef.current.style.top = `${y}px`;
      }
    }

    function animate(time: number) {
      const delta = Math.min((time - previousTime) / 1000, 0.04);
      previousTime = time;

      velocity.set(0, 0, 0);
      const cameraForward = monster.position.clone().sub(camera.position);
      cameraForward.y = 0;

      if (cameraForward.lengthSq() < 0.0001) {
        cameraForward.set(0, 0, -1);
      } else {
        cameraForward.normalize();
      }

      const cameraRight = new THREE.Vector3(-cameraForward.z, 0, cameraForward.x)
        .normalize();

      if (pressedKeys.has("ArrowUp")) {
        velocity.add(cameraForward);
      }

      if (pressedKeys.has("ArrowDown")) {
        velocity.sub(cameraForward);
      }

      if (pressedKeys.has("ArrowLeft")) {
        velocity.sub(cameraRight);
      }

      if (pressedKeys.has("ArrowRight")) {
        velocity.add(cameraRight);
      }

      if (joystickVector.lengthSq() > 0.0001) {
        velocity.addScaledVector(cameraRight, joystickVector.x);
        velocity.addScaledVector(cameraForward, joystickVector.y);
      }

      const wasMoving = velocity.lengthSq() > 0;

      if (wasMoving) {
        velocity.normalize().multiplyScalar(6.4 * delta);
        monster.position.x += velocity.x;
        monster.position.z += velocity.z;
        monster.rotation.y = Math.atan2(velocity.x, velocity.z);
      }

      const groundHeight = terrainHeight(monster.position.x, monster.position.z);
      const groundedY = groundHeight + 0.55;

      if (!isGrounded) {
        monster.position.y += jumpVelocity * delta;
        jumpVelocity -= 11 * delta;

        if (monster.position.y <= groundedY) {
          monster.position.y = groundedY;
          jumpVelocity = 0;
          isGrounded = true;
        }

        monster.userData.cameraTargetY = monster.position.y;
      } else {
        const idlePulse = !wasMoving ? Math.sin(time * 0.011) : 0;
        const gaitBounce = wasMoving ? Math.abs(Math.sin(time * 0.016)) * 0.16 : 0;
        const idleBounce = !wasMoving ? Math.abs(idlePulse) * 0.035 : 0;
        monster.position.y = groundedY + gaitBounce + idleBounce;
        monster.userData.cameraTargetY = wasMoving ? monster.position.y : groundedY;
      }

      const idlePulse = !wasMoving && isGrounded ? Math.sin(time * 0.011) : 0;
      monster.scale.y = 0.42 + (wasMoving ? Math.sin(time * 0.018) * 0.018 : idlePulse * 0.018);
      monster.scale.x = 0.42 - (monster.scale.y - 0.42) * 0.35;
      monster.scale.z = monster.scale.x;
      clouds.forEach((cloud) => {
        cloud.position.x += cloud.userData.speed;

        if (cloud.position.x > 94) {
          cloud.position.x = -94;
        }
      });
      roamingMonsters.forEach((roamingMonster, index) => {
        const phase = time * 0.00028 * roamingMonster.userData.speed + roamingMonster.userData.phase;
        const nextX = roamingMonster.userData.centerX + Math.cos(phase) * roamingMonster.userData.radius;
        const nextZ = roamingMonster.userData.centerZ + Math.sin(phase * 1.17) * roamingMonster.userData.radius;
        const previousX = roamingMonster.position.x;
        const previousZ = roamingMonster.position.z;
        const baseScale = roamingMonster.userData.baseScale;
        const movingBounce = Math.abs(Math.sin(time * 0.012 + index)) * 0.12;

        roamingMonster.position.set(
          nextX,
          terrainHeight(nextX, nextZ) + baseScale * 1.32 + movingBounce,
          nextZ,
        );
        roamingMonster.rotation.y = Math.atan2(nextX - previousX, nextZ - previousZ);
        roamingMonster.scale.y = baseScale * (1 + Math.sin(time * 0.011 + index) * 0.035);
        roamingMonster.scale.x = baseScale * (index % 2 === 0 ? 1.12 : 0.92) - (roamingMonster.scale.y - baseScale) * 0.28;
        roamingMonster.scale.z = baseScale;
      });
      roamingMonsters.forEach((roamingMonster) => {
        const distance = Math.hypot(
          roamingMonster.position.x - monster.position.x,
          roamingMonster.position.z - monster.position.z,
        );
        const speechExpiresAt = roamingMonster.userData.speechExpiresAt as
          | number
          | undefined;

        if (
          distance <= ROAMING_SPEECH_DISTANCE &&
          (!speechExpiresAt || time >= speechExpiresAt)
        ) {
          triggerRoamingSpeech(roamingMonster, time);
        }

        const activeExpiresAt = roamingMonster.userData.speechExpiresAt as
          | number
          | undefined;
        const speechSprite = roamingMonster.userData.speechSprite as
          | THREE.Sprite
          | undefined;
        const shouldShow =
          speechSprite !== undefined &&
          activeExpiresAt !== undefined &&
          time < activeExpiresAt;

        if (!speechSprite) {
          return;
        }

        speechSprite.visible = shouldShow;
        if (!shouldShow) {
          return;
        }

        speechSprite.position.copy(roamingMonster.position);
        speechSprite.position.y += 1.45;
      });
      updateWildCamera();
      updateFaceVisibilityThroughBody(
        wildFaceGroup,
        monster,
        camera,
        appearance.materialType === "glass",
      );
      updateMonsterOverlayPosition();

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    }

    resize();
    updateWildCamera();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("wild-joystick-move", onJoystickMove);
    window.addEventListener("wild-control-jump", jumpMonster);
    window.addEventListener("wild-photo-focus", onPhotoFocus);
    window.addEventListener("wild-photo-capture", onPhotoCapture);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("wild-joystick-move", onJoystickMove);
      window.removeEventListener("wild-control-jump", jumpMonster);
      window.removeEventListener("wild-photo-focus", onPhotoFocus);
      window.removeEventListener("wild-photo-capture", onPhotoCapture);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      activeTexture?.dispose();
      geometry.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();

          if (Array.isArray(object.material)) {
            object.material.forEach((material) => material.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
      cloudMaterial.dispose();
      roamingMonsters.forEach((roamingMonster) => {
        const speechSprite = roamingMonster.userData.speechSprite as
          | THREE.Sprite
          | undefined;
        if (speechSprite) {
          disposeRoamingSpeechSprite(speechSprite);
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [
    appearance,
    expression,
    monsterName,
    monsterSnapshot,
    particleColorVariance,
    particleStyle,
  ]);

  return (
    <main className="wild-screen">
      <button className="home-button" onClick={onBack} type="button">
        뒤로가기
      </button>
      <div
        className="wild-3d-stage"
        ref={mountRef}
        aria-label="내 몬스터가 움직이는 넓은 3D 야생 공간"
      />
      {photoFlash ? <div className="photo-flash-frame" aria-hidden="true" /> : null}
      {speechText ? (
        <div className="monster-speech-bubble" ref={speechBubbleRef}>
          {speechText}
        </div>
      ) : null}
      <div className="monster-name-tag" ref={nameTagRef}>
        {monsterName || "이름 없는 몬스터"}
      </div>
      <button
        className="photo-capture-button"
        onClick={() => {
          window.dispatchEvent(
            new Event(photoReady ? "wild-photo-capture" : "wild-photo-focus"),
          );
        }}
        type="button"
      >
        {photoReady ? "찰칵!" : "사진찍기"}
      </button>
      {showPhotoReview && capturedPhoto ? (
        <div className="photo-review-overlay" role="dialog" aria-label="찍은 사진 확인">
          <div className="photo-review-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="찍은 몬스터 사진" src={capturedPhoto} />
            <p>몬스터 도감에 추가하자!</p>
            <div className="photo-review-actions">
              <button
                onClick={() => {
                  setShowPhotoReview(false);
                  setShowEncyclopedia(true);
                }}
                type="button"
              >
                좋아!
              </button>
              <button
                onClick={() => {
                  setCapturedPhoto(null);
                  setPhotoReady(false);
                  setShowPhotoReview(false);
                }}
                type="button"
              >
                괜찮아!
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showEncyclopedia && capturedPhoto ? (
        <div className="encyclopedia-overlay" role="dialog" aria-label="몬스터 도감">
          <button
            className="encyclopedia-close-button"
            onClick={() => {
              setCapturedPhoto(null);
              setPhotoReady(false);
              setShowEncyclopedia(false);
            }}
            type="button"
            aria-label="몬스터 도감 닫기"
          >
            x
          </button>
          <div className="encyclopedia-book">
            <section>
              <span>Monster Archive</span>
              <h2>{monsterName || "이름 없는 몬스터"}</h2>
              <p>야생에서 만난 나만의 몬스터가 도감에 추가됐어요.</p>
              <div className="encyclopedia-actions">
                <button onClick={saveCapturedPhotoAsJpg} type="button">
                  사진 저장하기
                </button>
              </div>
            </section>
            <section>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="도감에 추가된 몬스터" src={capturedPhoto} />
            </section>
          </div>
        </div>
      ) : null}
      <div className="wild-control-cluster" aria-label="야생 이동 조작">
        <div
          className="wild-joystick-base"
          ref={joystickBaseRef}
          onPointerDown={(event) => {
            event.preventDefault();
            joystickPointerRef.current = event.pointerId;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateJoystickFromPointer(event);
          }}
          onPointerMove={(event) => {
            if (joystickPointerRef.current === event.pointerId) {
              updateJoystickFromPointer(event);
            }
          }}
          onPointerCancel={resetJoystick}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }

            resetJoystick();
          }}
          role="application"
          aria-label="원형 이동 조이스틱"
        >
          <div
            className="wild-joystick-knob"
            style={
              {
                "--joystick-x": `${joystickOffset.x}px`,
                "--joystick-y": `${joystickOffset.y}px`,
              } as React.CSSProperties
            }
          />
        </div>
      </div>
      <button
        className="wild-control-jump"
        onClick={dispatchWildJump}
        type="button"
        aria-label="점프"
      >
        점프
      </button>
      <input
        className="wild-chat-input"
        onChange={(event) => setChatText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();

          if (event.nativeEvent.isComposing) {
            return;
          }

          if (event.key !== "Enter") {
            return;
          }

          event.preventDefault();

          const trimmed = event.currentTarget.value.trim();

          if (!trimmed) {
            return;
          }

          setSpeechText(trimmed);
          setChatText("");
        }}
        placeholder="몬스터에게 말 걸기"
        value={chatText}
      />
    </main>
  );
}

export default function Home() {
  const claySceneRef = useRef<ClaySceneHandle>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isWild, setIsWild] = useState(false);
  const [wildMonsterSnapshot, setWildMonsterSnapshot] =
    useState<MonsterSnapshot | null>(null);
  const [monsterName, setMonsterName] = useState("");
  const [sceneKey, setSceneKey] = useState(0);
  const [brushEnabled, setBrushEnabled] = useState(false);
  const [materialPanelOpen, setMaterialPanelOpen] = useState(false);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [expressionPanelOpen, setExpressionPanelOpen] = useState(false);
  const [particlePanelOpen, setParticlePanelOpen] = useState(false);
  const [brushColor, setBrushColor] = useState(BRUSH_COLORS[0]);
  const [brushWheelPoint, setBrushWheelPoint] = useState({ x: 50, y: 50 });
  const [brushSize, setBrushSize] = useState(14);
  const [expressionColorTarget, setExpressionColorTarget] =
    useState<ExpressionColorTarget>("eyes");
  const [eyeHue, setEyeHue] = useState(DEFAULT_EXPRESSION_HUE);
  const [eyeSaturation, setEyeSaturation] = useState(DEFAULT_EXPRESSION_SATURATION);
  const [eyeLightness, setEyeLightness] = useState(DEFAULT_EXPRESSION_LIGHTNESS);
  const [eyeWheelPoint, setEyeWheelPoint] = useState({ x: 50, y: 50 });
  const [mouthHue, setMouthHue] = useState(DEFAULT_EXPRESSION_HUE);
  const [mouthSaturation, setMouthSaturation] = useState(DEFAULT_EXPRESSION_SATURATION);
  const [mouthLightness, setMouthLightness] = useState(DEFAULT_EXPRESSION_LIGHTNESS);
  const [mouthWheelPoint, setMouthWheelPoint] = useState({ x: 50, y: 50 });
  const [materialHue, setMaterialHue] = useState(DEFAULT_PICKER_HUE);
  const [materialSaturation, setMaterialSaturation] = useState(DEFAULT_PICKER_SATURATION);
  const [materialLightness, setMaterialLightness] = useState(DEFAULT_PICKER_LIGHTNESS);
  const [materialWheelPoint, setMaterialWheelPoint] = useState(DEFAULT_PICKER_WHEEL_POINT);
  const [colorApplied, setColorApplied] = useState(false);
  const [materialType, setMaterialType] = useState<MaterialType>("clay");
  const [textureDataUrl, setTextureDataUrl] = useState<string | null>(null);
  const [pressure, setPressure] = useState(0);
  const [sculptMode, setSculptMode] = useState<SculptMode>("concave");
  const [expression, setExpression] = useState<MonsterExpression>({
    eyes: "shine",
    mouth: "smile",
    eyeColor: DEFAULT_EXPRESSION_COLOR,
    mouthColor: DEFAULT_EXPRESSION_COLOR,
  });
  const [particleStyle, setParticleStyle] = useState<ParticleStyle>("none");
  const [particleColorVariance, setParticleColorVariance] = useState(0.35);
  const creatorRedoStackRef = useRef<CreatorHistorySnapshot[]>([]);
  const creatorUndoStackRef = useRef<CreatorHistorySnapshot[]>([]);
  const [, setCreatorHistoryVersion] = useState(0);
  const canRedo = creatorRedoStackRef.current.length > 0;
  const canUndo = creatorUndoStackRef.current.length > 0;
  const materialSettings: MonsterAppearance = {
    color: colorApplied
      ? hslToCssColor(materialHue, materialSaturation, materialLightness)
      : DEFAULT_CLAY_COLOR,
    materialType,
    textureDataUrl,
  };

  function captureCreatorHistorySnapshot(): CreatorHistorySnapshot {
    const claySnapshot = claySceneRef.current?.getSnapshot();

    return {
      brushColor,
      brushSize,
      brushWheelPoint: { ...brushWheelPoint },
      colorApplied,
      expression: { ...expression },
      expressionColorTarget,
      eyeHue,
      eyeLightness,
      eyeSaturation,
      eyeWheelPoint: { ...eyeWheelPoint },
      geometry: claySnapshot?.geometry ? new Float32Array(claySnapshot.geometry) : null,
      materialHue,
      materialLightness,
      materialSaturation,
      materialType,
      materialWheelPoint: { ...materialWheelPoint },
      mouthHue,
      mouthLightness,
      mouthSaturation,
      mouthWheelPoint: { ...mouthWheelPoint },
      paintMarks: claySnapshot?.paintMarks.map((mark) => ({ ...mark })) ?? [],
      particleColorVariance,
      particleStyle,
      pressure,
      sculptMode,
      textureDataUrl,
    };
  }

  function applyCreatorHistorySnapshot(snapshot: CreatorHistorySnapshot) {
    setBrushColor(snapshot.brushColor);
    setBrushSize(snapshot.brushSize);
    setBrushWheelPoint({ ...snapshot.brushWheelPoint });
    setColorApplied(snapshot.colorApplied);
    setExpression({ ...snapshot.expression });
    setExpressionColorTarget(snapshot.expressionColorTarget);
    setEyeHue(snapshot.eyeHue);
    setEyeLightness(snapshot.eyeLightness);
    setEyeSaturation(snapshot.eyeSaturation);
    setEyeWheelPoint({ ...snapshot.eyeWheelPoint });
    setMaterialHue(snapshot.materialHue);
    setMaterialLightness(snapshot.materialLightness);
    setMaterialSaturation(snapshot.materialSaturation);
    setMaterialType(snapshot.materialType);
    setMaterialWheelPoint({ ...snapshot.materialWheelPoint });
    setMouthHue(snapshot.mouthHue);
    setMouthLightness(snapshot.mouthLightness);
    setMouthSaturation(snapshot.mouthSaturation);
    setMouthWheelPoint({ ...snapshot.mouthWheelPoint });
    setParticleColorVariance(snapshot.particleColorVariance);
    setParticleStyle(snapshot.particleStyle);
    setPressure(snapshot.pressure);
    setSculptMode(snapshot.sculptMode);
    setTextureDataUrl(snapshot.textureDataUrl);
    claySceneRef.current?.restoreSnapshot({
      geometry: snapshot.geometry,
      paintMarks: snapshot.paintMarks,
    });
  }

  function pushCreatorHistory() {
    creatorUndoStackRef.current.push(captureCreatorHistorySnapshot());

    if (creatorUndoStackRef.current.length > 80) {
      creatorUndoStackRef.current.shift();
    }

    creatorRedoStackRef.current.length = 0;
    setCreatorHistoryVersion((current) => current + 1);
  }

  function undoCreatorChange() {
    const previous = creatorUndoStackRef.current.pop();

    if (!previous) {
      setCreatorHistoryVersion((current) => current + 1);
      return false;
    }

    creatorRedoStackRef.current.push(captureCreatorHistorySnapshot());
    applyCreatorHistorySnapshot(previous);
    setCreatorHistoryVersion((current) => current + 1);
    return true;
  }

  function redoCreatorChange() {
    const next = creatorRedoStackRef.current.pop();

    if (!next) {
      setCreatorHistoryVersion((current) => current + 1);
      return false;
    }

    creatorUndoStackRef.current.push(captureCreatorHistorySnapshot());
    applyCreatorHistorySnapshot(next);
    setCreatorHistoryVersion((current) => current + 1);
    return true;
  }

  function updateExpressionHue(event: React.MouseEvent<HTMLButtonElement> | React.PointerEvent<HTMLButtonElement>) {
    const color = getHueSaturationFromWheel(event);
    pushCreatorHistory();

    if (expressionColorTarget === "eyes") {
      const nextColor = hslToCssColor(color.hue, eyeSaturation, eyeLightness);
      setEyeHue(color.hue);
      setEyeWheelPoint({ x: color.x, y: color.y });
      setExpression((current) => ({ ...current, eyeColor: nextColor }));
      return;
    }

    const nextColor = hslToCssColor(color.hue, mouthSaturation, mouthLightness);
    setMouthHue(color.hue);
    setMouthWheelPoint({ x: color.x, y: color.y });
    setExpression((current) => ({ ...current, mouthColor: nextColor }));
  }

  function updateExpressionSaturation(nextSaturation: number) {
    pushCreatorHistory();

    if (expressionColorTarget === "eyes") {
      const nextColor = hslToCssColor(eyeHue, nextSaturation, eyeLightness);
      setEyeSaturation(nextSaturation);
      setExpression((current) => ({ ...current, eyeColor: nextColor }));
      return;
    }

    const nextColor = hslToCssColor(mouthHue, nextSaturation, mouthLightness);
    setMouthSaturation(nextSaturation);
    setExpression((current) => ({ ...current, mouthColor: nextColor }));
  }

  function updateExpressionLightness(nextLightness: number) {
    pushCreatorHistory();

    if (expressionColorTarget === "eyes") {
      const nextColor = hslToCssColor(eyeHue, eyeSaturation, nextLightness);
      setEyeLightness(nextLightness);
      setExpression((current) => ({ ...current, eyeColor: nextColor }));
      return;
    }

    const nextColor = hslToCssColor(mouthHue, mouthSaturation, nextLightness);
    setMouthLightness(nextLightness);
    setExpression((current) => ({ ...current, mouthColor: nextColor }));
  }

  function resetClayColorToDefault() {
    setMaterialHue(DEFAULT_PICKER_HUE);
    setMaterialSaturation(DEFAULT_PICKER_SATURATION);
    setMaterialLightness(DEFAULT_PICKER_LIGHTNESS);
    setMaterialWheelPoint({ ...DEFAULT_PICKER_WHEEL_POINT });
    setColorApplied(false);
  }

  function resetCreatorTools() {
    setBrushEnabled(false);
    setMaterialPanelOpen(false);
    setColorPanelOpen(false);
    setExpressionPanelOpen(false);
    setParticlePanelOpen(false);
    setBrushColor(BRUSH_COLORS[0]);
    setBrushWheelPoint({ x: 50, y: 50 });
    setBrushSize(14);
    setExpressionColorTarget("eyes");
    setEyeHue(DEFAULT_EXPRESSION_HUE);
    setEyeSaturation(DEFAULT_EXPRESSION_SATURATION);
    setEyeLightness(DEFAULT_EXPRESSION_LIGHTNESS);
    setEyeWheelPoint({ x: 50, y: 50 });
    setMouthHue(DEFAULT_EXPRESSION_HUE);
    setMouthSaturation(DEFAULT_EXPRESSION_SATURATION);
    setMouthLightness(DEFAULT_EXPRESSION_LIGHTNESS);
    setMouthWheelPoint({ x: 50, y: 50 });
    resetClayColorToDefault();
    setMaterialType("clay");
    setTextureDataUrl(null);
    setPressure(0);
    setSculptMode("concave");
    setExpression({
      eyes: "shine",
      mouth: "smile",
      eyeColor: DEFAULT_EXPRESSION_COLOR,
      mouthColor: DEFAULT_EXPRESSION_COLOR,
    });
    setParticleStyle("none");
    setParticleColorVariance(0.35);

    if (photoInputRef.current) {
      photoInputRef.current.value = "";
    }
  }

  function startGame() {
    setSceneKey((current) => current + 1);
    creatorUndoStackRef.current.length = 0;
    creatorRedoStackRef.current.length = 0;
    setCreatorHistoryVersion((current) => current + 1);
    resetCreatorTools();
    setIsFinished(false);
    setIsWild(false);
    setWildMonsterSnapshot(null);
    setMonsterName("");
    setHasStarted(true);
  }

  function goHome() {
    creatorUndoStackRef.current.length = 0;
    creatorRedoStackRef.current.length = 0;
    setCreatorHistoryVersion((current) => current + 1);
    resetCreatorTools();
    setIsFinished(false);
    setIsWild(false);
    setWildMonsterSnapshot(null);
    setMonsterName("");
    setHasStarted(false);
  }

  if (isWild) {
    return (
      <WildSpace
        appearance={materialSettings}
        expression={expression}
        monsterSnapshot={wildMonsterSnapshot}
        monsterName={monsterName}
        particleColorVariance={particleColorVariance}
        particleStyle={particleStyle}
        onBack={() => setIsWild(false)}
      />
    );
  }

  if (!hasStarted) {
    return (
      <main className="start-screen">
        <HomeMonsterDecorations />
        <div className="hero-card">
          <p className="eyebrow">Monster Clay Lab</p>
          <h1>나만의 몬스터 만들기</h1>
          <button className="play-button" onClick={startGame} type="button">
            시작하기
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="creator-screen">
      <ClayScene
        ref={claySceneRef}
        brushColor={brushColor}
        brushEnabled={brushEnabled}
        brushSize={brushSize}
        expression={expression}
        materialSettings={materialSettings}
        particleStyle={particleStyle}
        particleColorVariance={particleColorVariance}
        pressure={pressure}
        sculptMode={sculptMode}
        initialSnapshot={wildMonsterSnapshot}
        isFinished={isFinished}
        onHistoryCommit={pushCreatorHistory}
        resetKey={sceneKey}
      />

      <button
        className="home-button"
        onClick={isFinished ? () => setIsFinished(false) : goHome}
        type="button"
      >
        {isFinished ? "뒤로가기" : "처음으로"}
      </button>

      {!isFinished ? (
        <button
          className="finish-button"
          onClick={() => {
            setBrushEnabled(false);
            setMaterialPanelOpen(false);
            setColorPanelOpen(false);
            setExpressionPanelOpen(false);
            setParticlePanelOpen(false);
            setIsFinished(true);
          }}
          type="button"
        >
          완성!
        </button>
      ) : null}

      {isFinished ? (
        <button
          className="wild-button"
          onClick={() => {
            setWildMonsterSnapshot(claySceneRef.current?.getSnapshot() ?? null);
            setIsWild(true);
          }}
          type="button"
        >
          야생으로!
        </button>
      ) : null}

      {!isFinished ? (
        <div className="history-controls" aria-label="작업 단계 이동">
          <div className="history-button-row">
            <button
              className="history-button"
              disabled={!canUndo}
              onClick={() => {
                undoCreatorChange();
              }}
              type="button"
            >
              뒤로
            </button>
            <button
              className="history-button"
              disabled={!canRedo}
              onClick={() => {
                redoCreatorChange();
              }}
              type="button"
            >
              앞으로
            </button>
          </div>
        </div>
      ) : null}

      {!isFinished ? (
        <div className="pressure-control">
          <label className="pressure-slider">
            <span>압력</span>
            <input
              aria-label="반죽 압력"
              max="1"
              min="0"
              onChange={(event) => {
                pushCreatorHistory();
                setPressure(Number(event.target.value));
              }}
              step="0.1"
              type="range"
              value={pressure}
            />
            <strong>
              {pressure < 0.34 ? "약하게" : pressure < 0.67 ? "보통" : "강하게"}
            </strong>
          </label>
          <div className="sculpt-mode-buttons" aria-label="반죽 조형 방향">
            <button
              className={sculptMode === "concave" ? "is-selected" : ""}
              onClick={() => {
                pushCreatorHistory();
                setSculptMode("concave");
              }}
              type="button"
            >
              오목
            </button>
            <button
              className={sculptMode === "convex" ? "is-selected" : ""}
              onClick={() => {
                pushCreatorHistory();
                setSculptMode("convex");
              }}
              type="button"
            >
              볼록
            </button>
          </div>
        </div>
      ) : null}

      {isFinished ? (
        <p className="hint">나만의 몬스터에게 이름을 지어주세요!</p>
      ) : null}

      {isFinished ? (
        <input
          className="monster-name-input"
          onChange={(event) => setMonsterName(event.target.value)}
          placeholder="몬스터 이름"
          value={monsterName}
        />
      ) : null}

      {!isFinished ? (
        <button
          className="front-view-button"
          onClick={() => claySceneRef.current?.focusFront()}
          type="button"
        >
          정면
        </button>
      ) : null}

      {!isFinished ? (
        <div className="toolbar" aria-label="도구">
        {materialPanelOpen ? (
          <div className="material-panel" aria-label="소재 설정">
            <div className="material-buttons">
              <button
                className={materialType === "glass" ? "is-selected" : ""}
                onClick={() => {
                  pushCreatorHistory();
                  setMaterialType("glass");
                }}
                type="button"
              >
                유리
              </button>
              <button
                className={materialType === "metal" ? "is-selected" : ""}
                onClick={() => {
                  pushCreatorHistory();
                  setMaterialType("metal");
                }}
                type="button"
              >
                메탈
              </button>
              <label className="photo-button">
                사진
                <input
                  accept="image/png,image/jpeg"
                  onChange={(event) => {
                    const file = event.target.files?.[0];

                    if (!file) {
                      return;
                    }

                    const reader = new FileReader();
                    reader.onload = () => {
                      pushCreatorHistory();
                      setMaterialType("clay");
                      setTextureDataUrl(String(reader.result));
                      event.target.value = "";
                    };
                    reader.readAsDataURL(file);
                  }}
                  ref={photoInputRef}
                  type="file"
                />
              </label>
              <button
                className={
                  materialType === "clay" && !textureDataUrl ? "is-selected" : ""
                }
                onClick={() => {
                  pushCreatorHistory();
                  setMaterialType("clay");
                  setTextureDataUrl(null);

                  if (photoInputRef.current) {
                    photoInputRef.current.value = "";
                  }
                }}
                type="button"
              >
                선택 안함
              </button>
            </div>
          </div>
        ) : null}

        {colorPanelOpen ? (
          <div className="color-panel" aria-label="색깔 설정">
            <button
              className="color-wheel"
              onClick={(event) => {
                const color = getHueSaturationFromWheel(event);
                pushCreatorHistory();
                setMaterialHue(color.hue);
                setMaterialWheelPoint({ x: color.x, y: color.y });
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) {
                  const color = getHueSaturationFromWheel(event);
                  pushCreatorHistory();
                  setMaterialHue(color.hue);
                  setMaterialWheelPoint({ x: color.x, y: color.y });
                }
              }}
              style={
                {
                  "--brush-color": hslToCssColor(
                    materialHue,
                    materialSaturation,
                    materialLightness,
                  ),
                  "--wheel-x": `${materialWheelPoint.x}%`,
                  "--wheel-y": `${materialWheelPoint.y}%`,
                } as React.CSSProperties
              }
              type="button"
              aria-label="반죽 색상원"
            />
            <div className="material-sliders">
              <label>
                <span>채도</span>
                <input
                  max="100"
                  min="0"
                  onChange={(event) => {
                    pushCreatorHistory();
                    setMaterialSaturation(Number(event.target.value));
                  }}
                  type="range"
                  value={materialSaturation}
                />
              </label>
              <label>
                <span>명도</span>
                <input
                  max="100"
                  min="18"
                  onChange={(event) => {
                    pushCreatorHistory();
                    setMaterialLightness(Number(event.target.value));
                  }}
                  type="range"
                  value={materialLightness}
                />
              </label>
              <button
                className="plain-tool-button"
                onClick={() => {
                  pushCreatorHistory();
                  setColorApplied(true);
                }}
                type="button"
              >
                적용
              </button>
              <button
                className="plain-tool-button"
                onClick={() => {
                  pushCreatorHistory();
                  resetClayColorToDefault();
                }}
                type="button"
              >
                없음
              </button>
            </div>
          </div>
        ) : null}

        {expressionPanelOpen ? (
          <div className="expression-panel" aria-label="표정 설정">
            <div className="expression-style-row">
              <span>눈</span>
              {(["shine", "happy", "sleepy", "wink", "lash"] as EyeStyle[]).map((eyes, index) => (
                <button
                  className={expression.eyes === eyes ? "is-selected" : ""}
                  key={eyes}
                  onClick={() => {
                    pushCreatorHistory();
                    setExpression((current) => ({ ...current, eyes }));
                  }}
                  type="button"
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="expression-style-row">
              <span>입</span>
              {(["smile", "open", "cat", "tongue", "sad"] as MouthStyle[]).map((mouth, index) => (
                <button
                  className={expression.mouth === mouth ? "is-selected" : ""}
                  key={mouth}
                  onClick={() => {
                    pushCreatorHistory();
                    setExpression((current) => ({ ...current, mouth }));
                  }}
                  type="button"
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="expression-color-targets" aria-label="표정 색상 대상">
              <button
                className={expressionColorTarget === "eyes" ? "is-selected" : ""}
                onClick={() => {
                  pushCreatorHistory();
                  setExpressionColorTarget("eyes");
                }}
                type="button"
              >
                눈 색
              </button>
              <button
                className={expressionColorTarget === "mouth" ? "is-selected" : ""}
                onClick={() => {
                  pushCreatorHistory();
                  setExpressionColorTarget("mouth");
                }}
                type="button"
              >
                입 색
              </button>
            </div>
            <div className="expression-color-controls">
              <button
                className="color-wheel"
                onClick={updateExpressionHue}
                onPointerMove={(event) => {
                  if (event.buttons === 1) {
                    updateExpressionHue(event);
                  }
                }}
                style={
                  {
                    "--brush-color":
                      expressionColorTarget === "eyes"
                        ? expression.eyeColor
                        : expression.mouthColor,
                    "--wheel-x": `${
                      expressionColorTarget === "eyes"
                        ? eyeWheelPoint.x
                        : mouthWheelPoint.x
                    }%`,
                    "--wheel-y": `${
                      expressionColorTarget === "eyes"
                        ? eyeWheelPoint.y
                        : mouthWheelPoint.y
                    }%`,
                  } as React.CSSProperties
                }
                type="button"
                aria-label="표정 색상원"
              />
              <div className="material-sliders">
                <label>
                  <span>채도</span>
                  <input
                    max="100"
                    min="0"
                    onChange={(event) =>
                      updateExpressionSaturation(Number(event.target.value))
                    }
                    type="range"
                    value={
                      expressionColorTarget === "eyes"
                        ? eyeSaturation
                        : mouthSaturation
                    }
                  />
                </label>
                <label>
                  <span>명도</span>
                  <input
                    max="96"
                    min="4"
                    onChange={(event) =>
                      updateExpressionLightness(Number(event.target.value))
                    }
                    type="range"
                    value={
                      expressionColorTarget === "eyes"
                        ? eyeLightness
                        : mouthLightness
                    }
                  />
                </label>
              </div>
            </div>
          </div>
        ) : null}

        {particlePanelOpen ? (
          <div className="particle-panel" aria-label="파티클 설정">
            <div className="particle-style-buttons">
              {(["none", "stars", "bubbles", "sprinkles", "rings", "cubes"] as ParticleStyle[]).map(
                (style) => (
                  <button
                    className={particleStyle === style ? "is-selected" : ""}
                    key={style}
                    onClick={() => {
                      pushCreatorHistory();
                      setParticleStyle(style);
                    }}
                    type="button"
                  >
                    {
                      {
                        none: "없음",
                        stars: "별",
                        bubbles: "방울",
                        sprinkles: "스프링클",
                        rings: "링",
                        cubes: "큐브",
                      }[style]
                    }
                  </button>
                ),
              )}
            </div>
            <label className="particle-random-control">
              <span>색 랜덤</span>
              <input
                aria-label="파티클 색상 랜덤 정도"
                max="1"
                min="0"
                onChange={(event) => {
                  pushCreatorHistory();
                  setParticleColorVariance(Number(event.target.value));
                }}
                step="0.01"
                type="range"
                value={particleColorVariance}
              />
              <strong>{Math.round(particleColorVariance * 100)}</strong>
            </label>
          </div>
        ) : null}

        {brushEnabled ? (
          <div className="brush-panel" aria-label="브러시 설정">
            <button
              className="color-wheel"
              onClick={(event) => {
                const color = getColorFromWheel(event);
                pushCreatorHistory();
                setBrushColor(color.color);
                setBrushWheelPoint({ x: color.x, y: color.y });
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) {
                  const color = getColorFromWheel(event);
                  pushCreatorHistory();
                  setBrushColor(color.color);
                  setBrushWheelPoint({ x: color.x, y: color.y });
                }
              }}
              style={
                {
                  "--brush-color": brushColor,
                  "--wheel-x": `${brushWheelPoint.x}%`,
                  "--wheel-y": `${brushWheelPoint.y}%`,
                } as React.CSSProperties
              }
              type="button"
              aria-label="색상원"
            />
            <div className="brush-size-control">
              <span>Size</span>
              <input
                aria-label="브러시 크기"
                max="32"
                min="5"
                onChange={(event) => {
                  pushCreatorHistory();
                  setBrushSize(Number(event.target.value));
                }}
                type="range"
                value={brushSize}
              />
              <strong>{brushSize}</strong>
            </div>
            <div className="swatches" aria-label="추천 색상">
              {BRUSH_COLORS.map((color) => (
                <button
                  aria-label={`${color} 색상`}
                  className="swatch"
                  key={color}
                  onClick={() => {
                    pushCreatorHistory();
                    setBrushColor(color);
                  }}
                  style={{ background: color }}
                  type="button"
                />
              ))}
            </div>
          </div>
        ) : null}

        {brushEnabled ||
        materialPanelOpen ||
        colorPanelOpen ||
        expressionPanelOpen ||
        particlePanelOpen ? (
          <button
            aria-label="도구 창 닫기"
            className="close-brush-button"
            onClick={() => {
              setBrushEnabled(false);
              setMaterialPanelOpen(false);
              setColorPanelOpen(false);
              setExpressionPanelOpen(false);
              setParticlePanelOpen(false);
            }}
            type="button"
          >
            x
          </button>
        ) : (
          <>
            <button
              className="tool-button"
              onClick={() => {
                setMaterialPanelOpen(true);
                setColorPanelOpen(false);
                setBrushEnabled(false);
                setExpressionPanelOpen(false);
                setParticlePanelOpen(false);
              }}
              type="button"
            >
              소재
            </button>
            <button
              className="tool-button"
              onClick={() => {
                setColorPanelOpen(true);
                setMaterialPanelOpen(false);
                setBrushEnabled(false);
                setExpressionPanelOpen(false);
                setParticlePanelOpen(false);
              }}
              type="button"
            >
              색깔
            </button>
            <button
              className="tool-button"
              onClick={() => {
                setBrushEnabled(true);
                setMaterialPanelOpen(false);
                setColorPanelOpen(false);
                setExpressionPanelOpen(false);
                setParticlePanelOpen(false);
              }}
              type="button"
              aria-pressed={brushEnabled}
            >
              <span aria-hidden="true">브러쉬</span>
              <span className="sr-only">붓 도구</span>
            </button>
            <button
              className="tool-button"
              onClick={() => {
                setExpressionPanelOpen(true);
                setBrushEnabled(false);
                setMaterialPanelOpen(false);
                setColorPanelOpen(false);
                setParticlePanelOpen(false);
              }}
              type="button"
            >
              표정
            </button>
            <button
              className="tool-button"
              onClick={() => {
                setParticlePanelOpen(true);
                setBrushEnabled(false);
                setMaterialPanelOpen(false);
                setColorPanelOpen(false);
                setExpressionPanelOpen(false);
              }}
              type="button"
            >
              파티클
            </button>
          </>
        )}
        </div>
      ) : null}
    </main>
  );
}
