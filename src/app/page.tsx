"use client";

import {
  forwardRef,
  useCallback,
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
  isFinished: boolean;
  onHistoryChange: (canUndo: boolean, canRedo: boolean) => void;
  resetKey: number;
};

type ClaySceneHandle = {
  getSnapshot: () => Float32Array | null;
  redo: () => void;
  undo: () => void;
};

type InteractionMode = "orbit" | "sculpt" | "paint" | null;

const BRUSH_COLORS = [
  "#7652ff",
  "#ff5f8f",
  "#ffb020",
  "#39c76f",
  "#48b8ff",
  "#2d2a32",
];

function createClayGeometry() {
  const geometry = new THREE.SphereGeometry(1.55, 96, 96);
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
  return geometry;
}

function buildNeighborMap(geometry: THREE.BufferGeometry) {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const neighbors = Array.from({ length: position.count }, () => new Set<number>());
  const index = geometry.index;

  if (!index) {
    return neighbors.map((set) => [...set]);
  }

  for (let item = 0; item < index.count; item += 3) {
    const a = index.getX(item);
    const b = index.getX(item + 1);
    const c = index.getX(item + 2);

    neighbors[a].add(b).add(c);
    neighbors[b].add(a).add(c);
    neighbors[c].add(a).add(b);
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

const ClayScene = forwardRef<ClaySceneHandle, ClaySceneProps>(function ClayScene(
  { brushColor, brushEnabled, brushSize, isFinished, onHistoryChange, resetKey },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const brushEnabledRef = useRef(brushEnabled);
  const brushColorRef = useRef(brushColor);
  const brushSizeRef = useRef(brushSize);
  const isFinishedRef = useRef(isFinished);
  const undoActionRef = useRef<() => void>(() => undefined);
  const redoActionRef = useRef<() => void>(() => undefined);
  const snapshotActionRef = useRef<() => Float32Array | null>(() => null);

  useImperativeHandle(
    ref,
    () => ({
      getSnapshot: () => snapshotActionRef.current(),
      redo: () => redoActionRef.current(),
      undo: () => undoActionRef.current(),
    }),
    [],
  );

  useEffect(() => {
    brushEnabledRef.current = brushEnabled;
    brushColorRef.current = brushColor;
    brushSizeRef.current = brushSize;
    isFinishedRef.current = isFinished;
  }, [brushColor, brushEnabled, brushSize, isFinished]);

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
    const history = {
      redo: [] as Float32Array[],
      undo: [] as Float32Array[],
    };
    const clayMaterial = new THREE.MeshPhysicalMaterial({
      color: "#fffdf7",
      roughness: 0.82,
      clearcoat: 0.24,
      clearcoatRoughness: 0.72,
      sheen: 0.35,
      sheenColor: new THREE.Color("#ffffff"),
    });
    const clay = new THREE.Mesh(clayGeometry, clayMaterial);
    clay.castShadow = true;
    clay.receiveShadow = true;
    monsterGroup.add(clay);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.35, 96),
      new THREE.ShadowMaterial({ color: "#5d5148", opacity: 0.18 }),
    );
    floor.position.y = -1.72;
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const ambientLight = new THREE.HemisphereLight("#ffffff", "#d6c7b4", 1.6);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight("#ffffff", 3.6);
    keyLight.position.set(2.8, 4.6, 3.4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight("#d8ecff", 1.4);
    rimLight.position.set(-3.5, 1.9, -3.2);
    scene.add(rimLight);

    function cloneGeometryState() {
      return new Float32Array(position.array as Float32Array);
    }

    function updateHistoryAvailability() {
      onHistoryChange(history.undo.length > 0, history.redo.length > 0);
    }

    function applyGeometryState(snapshot: Float32Array) {
      (position.array as Float32Array).set(snapshot);
      weldSharedVertices();
      position.needsUpdate = true;
      clayGeometry.computeVertexNormals();
      smoothSharedNormals();
      updateHistoryAvailability();
    }

    function pushHistoryState() {
      history.undo.push(cloneGeometryState());

      if (history.undo.length > 40) {
        history.undo.shift();
      }

      history.redo.length = 0;
      updateHistoryAvailability();
    }

    undoActionRef.current = () => {
      const previous = history.undo.pop();

      if (!previous) {
        updateHistoryAvailability();
        return;
      }

      history.redo.push(cloneGeometryState());
      applyGeometryState(previous);
    };

    redoActionRef.current = () => {
      const next = history.redo.pop();

      if (!next) {
        updateHistoryAvailability();
        return;
      }

      history.undo.push(cloneGeometryState());
      applyGeometryState(next);
    };
    snapshotActionRef.current = () => cloneGeometryState();

    updateHistoryAvailability();

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
      if (lastPaintPoint.distanceTo(hit.point) < brushSizeRef.current / 180) {
        return;
      }

      const normal = hit.face?.normal.clone() ?? new THREE.Vector3(0, 0, 1);
      normal.transformDirection(clay.matrixWorld).normalize();

      const mark = new THREE.Mesh(
        new THREE.CircleGeometry(brushSizeRef.current / 95, 40),
        new THREE.MeshBasicMaterial({
          color: brushColorRef.current,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        }),
      );
      mark.position.copy(hit.point).addScaledVector(normal, 0.015);
      mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      mark.renderOrder = 1;
      monsterGroup.worldToLocal(mark.position);
      monsterGroup.add(mark);
      lastPaintPoint.copy(hit.point);
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

    function smoothClaySurface(center: THREE.Vector3, radius: number) {
      const original = new Float32Array(position.array as Float32Array);
      const vertex = new THREE.Vector3();
      const neighborVertex = new THREE.Vector3();
      const average = new THREE.Vector3();

      for (let pass = 0; pass < 3; pass += 1) {
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

          const influence = Math.pow(1 - distance / (radius * 1.5), 2) * 0.28;
          vertex.lerp(average, influence);

          const fromOriginal = new THREE.Vector3(
            original[index * 3],
            original[index * 3 + 1],
            original[index * 3 + 2],
          );
          const minRadius = fromOriginal.length() * 0.72;
          const maxRadius = fromOriginal.length() * 1.22;
          const currentRadius = vertex.length();

          if (currentRadius < minRadius || currentRadius > maxRadius) {
            vertex.setLength(THREE.MathUtils.clamp(currentRadius, minRadius, maxRadius));
          }

          position.setXYZ(index, vertex.x, vertex.y, vertex.z);
        }

        weldSharedVertices();
      }
    }

    function sculptAt(currentHit: THREE.Intersection<THREE.Object3D>) {
      localHit.copy(currentHit.point);
      clay.worldToLocal(localHit);

      const move = localHit.clone().sub(lastLocalHit);
      const vertex = new THREE.Vector3();
      const sculptRadius = 0.52;

      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index);
        const distance = vertex.distanceTo(lastLocalHit);

        if (distance > sculptRadius) {
          continue;
        }

        const influence = Math.pow(1 - distance / sculptRadius, 2);
        const normalPush = vertex.clone().normalize().multiplyScalar(0.004);
        vertex.addScaledVector(move, influence * 0.54);
        vertex.addScaledVector(normalPush, influence);
        position.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }

      smoothClaySurface(lastLocalHit, sculptRadius);
      weldSharedVertices();
      position.needsUpdate = true;
      clayGeometry.computeVertexNormals();
      smoothSharedNormals();
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
          paintAt(hit);
        } else {
          pushHistoryState();
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
    weldSharedVertices();
    clayGeometry.computeVertexNormals();
    smoothSharedNormals();
    updateCamera(camera, target, orbit.yaw, orbit.pitch, orbit.radius);
    renderer.setAnimationLoop(() => {
      if (isFinishedRef.current) {
        monsterGroup.rotation.y -= 0.006;
      }

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
      undoActionRef.current = () => undefined;
      redoActionRef.current = () => undefined;
      snapshotActionRef.current = () => null;
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
  }, [onHistoryChange, resetKey]);

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
  const angle = (Math.atan2(y, x) * 180) / Math.PI + 180;
  const saturation = Math.min(100, (Math.hypot(x, y) / (bounds.width / 2)) * 100);

  return `hsl(${angle.toFixed(0)} ${saturation.toFixed(0)}% 56%)`;
}

function HomeMonsterDecorations() {
  const monsters = [
    { color: "#fffdf7", delay: "0s", left: "10%", size: "120px" },
    { color: "#ffb8cf", delay: "-0.8s", left: "24%", size: "86px" },
    { color: "#bda8ff", delay: "-1.7s", left: "39%", size: "108px" },
    { color: "#9ce7ff", delay: "-0.3s", left: "54%", size: "92px" },
    { color: "#ffe39b", delay: "-2.2s", left: "68%", size: "118px" },
    { color: "#b6f7c8", delay: "-1.1s", left: "82%", size: "96px" },
  ];

  return (
    <div className="home-monsters" aria-hidden="true">
      {monsters.map((monster, index) => (
        <div
          className="home-monster"
          key={`${monster.color}-${index}`}
          style={
            {
              "--monster-color": monster.color,
              "--monster-delay": monster.delay,
              "--monster-left": monster.left,
              "--monster-size": monster.size,
            } as React.CSSProperties
          }
        >
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function WildSpace({
  monsterSnapshot,
  onBack,
}: {
  monsterSnapshot: Float32Array | null;
  onBack: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return;
    }

    const mountElement = mount;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog("#eef6ff", 16, 42);

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 100);
    camera.position.set(7, 5.4, 8);
    camera.lookAt(0, 0.5, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountElement.appendChild(renderer.domElement);

    const geometry = createClayGeometry();
    const position = geometry.attributes.position as THREE.BufferAttribute;

    if (monsterSnapshot && monsterSnapshot.length === position.array.length) {
      (position.array as Float32Array).set(monsterSnapshot);
      position.needsUpdate = true;
      geometry.computeVertexNormals();
    }

    const monster = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: "#fffdf7",
        roughness: 0.78,
        clearcoat: 0.18,
        clearcoatRoughness: 0.7,
      }),
    );
    monster.scale.setScalar(0.42);
    monster.position.y = 0.55;
    monster.castShadow = true;
    monster.receiveShadow = true;
    scene.add(monster);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(34, 34, 20, 20),
      new THREE.MeshStandardMaterial({
        color: "#f7fbff",
        roughness: 0.92,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(34, 34, "#d7e3ef", "#e7eef6");
    grid.position.y = 0.01;
    scene.add(grid);

    scene.add(new THREE.HemisphereLight("#ffffff", "#cbd8e6", 1.7));

    const keyLight = new THREE.DirectionalLight("#ffffff", 3.2);
    keyLight.position.set(5, 9, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    scene.add(keyLight);

    const pressedKeys = new Set<string>();
    const velocity = new THREE.Vector3();
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

    function onKeyDown(event: KeyboardEvent) {
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(
          event.key,
        )
      ) {
        event.preventDefault();
      }

      if (event.key === " " && isGrounded) {
        jumpVelocity = 4.8;
        isGrounded = false;
        return;
      }

      pressedKeys.add(event.key);
    }

    function onKeyUp(event: KeyboardEvent) {
      pressedKeys.delete(event.key);
    }

    function animate(time: number) {
      const delta = Math.min((time - previousTime) / 1000, 0.04);
      previousTime = time;

      velocity.set(0, 0, 0);

      if (pressedKeys.has("ArrowUp")) {
        velocity.z -= 1;
      }

      if (pressedKeys.has("ArrowDown")) {
        velocity.z += 1;
      }

      if (pressedKeys.has("ArrowLeft")) {
        velocity.x -= 1;
      }

      if (pressedKeys.has("ArrowRight")) {
        velocity.x += 1;
      }

      if (velocity.lengthSq() > 0) {
        velocity.normalize().multiplyScalar(5.2 * delta);
        monster.position.x = THREE.MathUtils.clamp(
          monster.position.x + velocity.x,
          -14,
          14,
        );
        monster.position.z = THREE.MathUtils.clamp(
          monster.position.z + velocity.z,
          -14,
          14,
        );
        monster.rotation.y = Math.atan2(velocity.x, velocity.z);
      }

      if (!isGrounded) {
        monster.position.y += jumpVelocity * delta;
        jumpVelocity -= 11 * delta;

        if (monster.position.y <= 0.55) {
          monster.position.y = 0.55;
          jumpVelocity = 0;
          isGrounded = true;
        }
      }

      monster.scale.y = 0.42 + (isGrounded ? Math.sin(time * 0.008) * 0.015 : 0.04);
      monster.scale.x = 0.42 - (monster.scale.y - 0.42) * 0.35;
      monster.scale.z = monster.scale.x;

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    }

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    animationFrame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
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
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [monsterSnapshot]);

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
    </main>
  );
}

export default function Home() {
  const claySceneRef = useRef<ClaySceneHandle>(null);
  const [hasStarted, setHasStarted] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isWild, setIsWild] = useState(false);
  const [wildMonsterSnapshot, setWildMonsterSnapshot] = useState<Float32Array | null>(
    null,
  );
  const [sceneKey, setSceneKey] = useState(0);
  const [brushEnabled, setBrushEnabled] = useState(false);
  const [brushColor, setBrushColor] = useState(BRUSH_COLORS[0]);
  const [brushSize, setBrushSize] = useState(14);
  const [canRedo, setCanRedo] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  const updateHistoryState = useCallback((nextCanUndo: boolean, nextCanRedo: boolean) => {
    setCanUndo(nextCanUndo);
    setCanRedo(nextCanRedo);
  }, []);

  function startGame() {
    setSceneKey((current) => current + 1);
    setBrushEnabled(false);
    setIsFinished(false);
    setIsWild(false);
    setWildMonsterSnapshot(null);
    setCanRedo(false);
    setCanUndo(false);
    setHasStarted(true);
  }

  function goHome() {
    setBrushEnabled(false);
    setIsFinished(false);
    setIsWild(false);
    setWildMonsterSnapshot(null);
    setHasStarted(false);
  }

  if (isWild) {
    return (
      <WildSpace
        monsterSnapshot={wildMonsterSnapshot}
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
        isFinished={isFinished}
        onHistoryChange={updateHistoryState}
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
        <button
          className="history-button"
          disabled={!canUndo}
          onClick={() => claySceneRef.current?.undo()}
          type="button"
        >
          뒤로
        </button>
        <button
          className="history-button"
          disabled={!canRedo}
          onClick={() => claySceneRef.current?.redo()}
          type="button"
        >
          앞으로
        </button>
        </div>
      ) : null}

      <p className="hint">
        {isFinished
          ? "나만의 몬스터 완성!"
          : brushEnabled
          ? "찰흙을 드래그하면 색을 칠하고, 빈 공간 드래그와 스크롤로 카메라를 움직입니다."
          : "찰흙은 드래그해서 만지고, 빈 공간은 드래그, 스크롤은 줌인/줌아웃입니다."}
      </p>

      {!isFinished ? (
        <div className="toolbar" aria-label="도구">
        {brushEnabled ? (
          <div className="brush-panel" aria-label="브러시 설정">
            <button
              className="color-wheel"
              onClick={(event) => setBrushColor(getColorFromWheel(event))}
              onPointerMove={(event) => {
                if (event.buttons === 1) {
                  setBrushColor(getColorFromWheel(event));
                }
              }}
              style={{ "--brush-color": brushColor } as React.CSSProperties}
              type="button"
              aria-label="색상원"
            />
            <div className="brush-size-control">
              <span>Size</span>
              <input
                aria-label="브러시 크기"
                max="32"
                min="5"
                onChange={(event) => setBrushSize(Number(event.target.value))}
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
                  onClick={() => setBrushColor(color)}
                  style={{ background: color }}
                  type="button"
                />
              ))}
            </div>
          </div>
        ) : null}

        {brushEnabled ? (
          <button
            aria-label="브러시 창 닫기"
            className="close-brush-button"
            onClick={() => setBrushEnabled(false)}
            type="button"
          >
            x
          </button>
        ) : (
          <button
            className="tool-button"
            onClick={() => setBrushEnabled(true)}
            type="button"
            aria-pressed={brushEnabled}
          >
            <span aria-hidden="true">Brush</span>
            <span className="sr-only">붓 도구</span>
          </button>
        )}
        </div>
      ) : null}
    </main>
  );
}
