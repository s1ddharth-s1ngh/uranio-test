import { useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { PointerState } from "./useWindowPointer";

export const KICK_CONFIG = {
  strength: 20,
  maxStrength: 70,
  minPointerSpeed: 0.3, 
  mass: 1.5,
  inertia: 1.0,
  k: 30,
  c: 4.5,
  damping: 3.5, 
  restoreTorque: 5, 
  hitScale: 0.95, // Scala la bounding sphere per essere un po' più stretta
  depth: 0.8,
};

export interface LetterPiece {
  id: string;
  restPos: [number, number, number];
  sizeFactor: number;
  boundR: number;
}

interface LetterState {
  origin: THREE.Vector3;
  originQuat: THREE.Quaternion;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  wasInside: boolean;
}

interface UseLetterPhysicsArgs {
  pieces: LetterPiece[];
  groups: RefObject<(THREE.Group | null)[]>;
  pointer: RefObject<PointerState>;
  reduceMotion: boolean;
  ambient: boolean;
}

function distToSegmentSquared(p: THREE.Vector2, v: THREE.Vector2, w: THREE.Vector2) {
  const l2 = v.distanceToSquared(w);
  if (l2 === 0) return { distSq: p.distanceToSquared(v), hitPoint: v };
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = new THREE.Vector2(v.x + t * (w.x - v.x), v.y + t * (w.y - v.y));
  return { distSq: p.distanceToSquared(proj), hitPoint: proj };
}

export function useLetterPhysics({
  pieces,
  groups,
  pointer,
  reduceMotion,
  ambient
}: UseLetterPhysicsArgs) {
  
  const states = useRef<LetterState[]>([]);
  if (states.current.length === 0) {
    states.current = pieces.map(p => ({
      origin: new THREE.Vector3(...p.restPos),
      originQuat: new THREE.Quaternion(),
      position: new THREE.Vector3(...p.restPos),
      quaternion: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
      wasInside: false,
    }));
  }

  const prevPointer = useRef(new THREE.Vector2());
  const hasPrev = useRef(false);
  const screenC = useRef(new THREE.Vector3());
  const tempV2 = useRef(new THREE.Vector2());
  const tempPointerV2 = useRef(new THREE.Vector2());
  
  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 30);

    // Se riduciamo il movimento o touch, andiamo lentamente a riposo e skippiamo input
    const isFrozen = reduceMotion || ambient;
    
    const p = pointer.current;
    const aspect = state.size.width / state.size.height;
    
    let isHitFrame = false;
    let mvx = 0;
    let mvy = 0;
    let speed = 0;
    
    tempPointerV2.current.set(p.x * aspect, p.y);
    
    if (p.active && !isFrozen) {
      if (hasPrev.current) {
        mvx = (p.x * aspect - prevPointer.current.x);
        mvy = p.y - prevPointer.current.y;
        speed = Math.hypot(mvx, mvy) / dt;
        isHitFrame = speed > KICK_CONFIG.minPointerSpeed;
      }
    }
    
    const gs = groups.current;
    if (!gs) return;

    for (let i = 0; i < states.current.length; i++) {
      const s = states.current[i];
      const g = gs[i];
      if (!g) continue;
      
      if (p.active && hasPrev.current && isHitFrame) {
        const pCenter = new THREE.Vector3().setFromMatrixPosition(g.matrixWorld);
        const pEdge = pCenter.clone().add(new THREE.Vector3(pieces[i].boundR, 0, 0));
        
        pCenter.project(state.camera);
        pEdge.project(state.camera);
        
        screenC.current.copy(pCenter);
        tempV2.current.set(screenC.current.x * aspect, screenC.current.y);
        
        const edgeX = pEdge.x * aspect;
        const edgeY = pEdge.y;
        const pieceRadius = Math.hypot(edgeX - tempV2.current.x, edgeY - tempV2.current.y) * KICK_CONFIG.hitScale;
        
        const { distSq, hitPoint } = distToSegmentSquared(
          tempV2.current,
          prevPointer.current,
          tempPointerV2.current
        );
        
        const isInside = distSq < pieceRadius * pieceRadius;
        
        if (isInside && !s.wasInside) {
          const v = new THREE.Vector3(mvx / dt, mvy / dt, 0);
          
          let F = v.clone().multiplyScalar(KICK_CONFIG.strength * pieces[i].sizeFactor);
          if (F.length() > KICK_CONFIG.maxStrength) {
            F.setLength(KICK_CONFIG.maxStrength);
          }
          
          const rX = hitPoint.x - tempV2.current.x;
          const rY = hitPoint.y - tempV2.current.y;
          
          const r = new THREE.Vector3(rX * 4, rY * 4, KICK_CONFIG.depth / 2); 
          
          const torque = r.clone().cross(F).divideScalar(KICK_CONFIG.inertia * pieces[i].sizeFactor);
          s.angularVelocity.add(torque);
          
          const spinta = F.clone().divideScalar(KICK_CONFIG.mass * pieces[i].sizeFactor);
          s.velocity.add(spinta);
        }
        
        s.wasInside = isInside;
      } else if (!p.active) {
        s.wasInside = false;
      }
      
      const forceP = s.origin.clone().sub(s.position).multiplyScalar(KICK_CONFIG.k);
      forceP.sub(s.velocity.clone().multiplyScalar(KICK_CONFIG.c));
      s.velocity.add(forceP.multiplyScalar(dt));
      s.position.add(s.velocity.clone().multiplyScalar(dt));
      
      s.angularVelocity.multiplyScalar(Math.exp(-KICK_CONFIG.damping * dt));
      
      const invCurrent = s.quaternion.clone().invert();
      const deltaQ = s.originQuat.clone().multiply(invCurrent);
      
      const axis = new THREE.Vector3(deltaQ.x, deltaQ.y, deltaQ.z);
      const sinHalfAngle = axis.length();
      if (sinHalfAngle > 0.001) {
        axis.normalize();
        let angle = 2 * Math.atan2(sinHalfAngle, deltaQ.w);
        if (angle > Math.PI) angle -= 2 * Math.PI;
        
        const restoreTorqueVec = axis.multiplyScalar(angle * KICK_CONFIG.restoreTorque);
        s.angularVelocity.add(restoreTorqueVec.multiplyScalar(dt));
      }
      
      if (s.angularVelocity.lengthSq() > 0.0001) {
        const w = s.angularVelocity.length();
        const spinAxis = s.angularVelocity.clone().normalize();
        const spinQ = new THREE.Quaternion().setFromAxisAngle(spinAxis, w * dt);
        s.quaternion.premultiply(spinQ);
        s.quaternion.normalize();
      }
      
      const distFromOrigin = s.position.distanceTo(s.origin);
      if (
        s.velocity.lengthSq() < 0.01 &&
        s.angularVelocity.lengthSq() < 0.01 &&
        distFromOrigin < 0.01 &&
        s.quaternion.angleTo(s.originQuat) < 0.01
      ) {
        s.position.copy(s.origin);
        s.quaternion.copy(s.originQuat);
        s.velocity.set(0, 0, 0);
        s.angularVelocity.set(0, 0, 0);
      }
      
      g.position.copy(s.position);
      g.quaternion.copy(s.quaternion);
    }
    
    if (p.active && !isFrozen) {
      prevPointer.current.set(p.x * aspect, p.y);
      hasPrev.current = true;
    } else {
      hasPrev.current = false;
    }
  });
}
