(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('three')) :
    typeof define === 'function' && define.amd ? define(['exports', 'three'], factory) :
    (global = global || self, factory(global.threecsg = {}, global.THREE));
}(this, function (exports, three) { 'use strict';

    const EPSILON = 1e-6;
    const CLASSIFY_COPLANAR = 0;
    const CLASSIFY_FRONT = 1;
    const CLASSIFY_BACK = 2;
    const CLASSIFY_SPANNING = 3;
    const tempVector3 = new three.Vector3();
    class Triangle {
        constructor(a, b, c) {
            this.a = a.clone();
            this.b = b.clone();
            this.c = c.clone();
            this.normal = new three.Vector3();
            tempVector3.copy(c).sub(a);
            this.normal.copy(b).sub(a).cross(tempVector3).normalize();
            this.w = this.normal.dot(a);
        }
        classifyPoint(point) {
            const side = this.normal.dot(point) - this.w;
            if (Math.abs(side) < EPSILON)
                return CLASSIFY_COPLANAR;
            if (side > 0)
                return CLASSIFY_FRONT;
            return CLASSIFY_BACK;
        }
        classifySide(triangle) {
            let side = CLASSIFY_COPLANAR;
            side |= this.classifyPoint(triangle.a);
            side |= this.classifyPoint(triangle.b);
            side |= this.classifyPoint(triangle.c);
            return side;
        }
        invert() {
            const { a, c } = this;
            this.a = c;
            this.c = a;
            this.normal.multiplyScalar(-1);
            this.w *= -1;
        }
        clone() {
            return new Triangle(this.a.clone(), this.b.clone(), this.c.clone());
        }
    }

    function isBufferGeometry(geometry) {
        return geometry instanceof three.BufferGeometry;
    }
    function isConvexSet(triangles) {
        for (let i = 0; i < triangles.length; i++) {
            for (let j = i + 1; j < triangles.length; j++) {
                const side = triangles[i].classifySide(triangles[j]);
                if (side & CLASSIFY_FRONT)
                    return false;
            }
        }
        return true;
    }

    const MINIMUM_RELATION = 0.5; // 0 -> 1
    const MINIMUM_RELATION_SCALE = 5; // should always be >2
    function chooseDividingTriangle(triangles) {
        if (isConvexSet(triangles))
            return undefined;
        let minimumRelation = MINIMUM_RELATION;
        let bestTriangle = undefined;
        let leastSplits = Infinity;
        let bestRelation = 0;
        // Find the triangle that best divides the set
        while (bestTriangle === undefined) {
            for (let i = 0; i < triangles.length; i++) {
                const triangleOuter = triangles[i];
                // Count the number of polygons on the positive side, negative side, and spanning the plane defined by the current triangle
                let numFront = 0;
                let numBack = 0;
                let numSpanning = 0;
                for (let j = 0; j < triangles.length; j++) {
                    if (i === j)
                        continue;
                    const triangleInner = triangles[j];
                    const side = triangleOuter.classifySide(triangleInner);
                    if (side === CLASSIFY_SPANNING) {
                        numSpanning++;
                    }
                    else if (side === CLASSIFY_FRONT) {
                        numFront++;
                    }
                    else if (side === CLASSIFY_BACK) {
                        numBack++;
                    }
                }
                // Calculate the relation between the number of triangles in the two sets divided by the current triangle
                const relation = numFront < numBack ? numFront / numBack : numBack / numFront;
                // Compare the results given by the current triangle to the best so far.
                // If the this triangle splits fewer triangles and the relation
                // between the resulting sets is acceptable this is the new candidate
                // triangle. If the current triangle splits the same amount of triangles
                // as the best triangle so far and the relation between the two
                // resulting sets is better then this triangle is the new candidate
                // triangle.
                if (relation > minimumRelation &&
                    (numSpanning < leastSplits ||
                        (numSpanning === leastSplits && relation > bestRelation))) {
                    bestTriangle = triangleOuter;
                    leastSplits = numSpanning;
                    bestRelation = relation;
                }
            }
            minimumRelation = minimumRelation / MINIMUM_RELATION_SCALE;
        }
        return bestTriangle;
    }
    class BSPNode {
        constructor(triangles) {
            this.triangles = [];
            this.isInverted = false;
            if (triangles !== undefined) {
                this.buildFrom(triangles);
            }
        }
        static interpolateVectors(a, b, t) {
            return a.clone().lerp(b, t);
        }
        static verticesToTriangles(vertices) {
            const triangles = [];
            for (let i = 2; i < vertices.length; i++) {
                const a = vertices[0];
                const b = vertices[i - 1];
                const c = vertices[i];
                const triangle = new Triangle(a, b, c);
                triangles.push(triangle);
            }
            return triangles;
        }
        buildFrom(triangles) {
            if (this.divider === undefined) {
                const bestDivider = chooseDividingTriangle(triangles);
                if (bestDivider === undefined) {
                    this.divider = triangles[0].clone();
                    this.triangles = triangles;
                }
                else {
                    this.divider = bestDivider.clone();
                    this.triangles = [];
                    this.addTriangles(triangles);
                }
            }
            else {
                this.addTriangles(triangles);
            }
        }
        addTriangles(triangles) {
            const frontTriangles = [];
            const backTriangles = [];
            for (let i = 0; i < triangles.length; i++) {
                const triangle = triangles[i];
                const side = this.divider.classifySide(triangle);
                if (side === CLASSIFY_COPLANAR) {
                    this.triangles.push(triangle);
                }
                else if (side === CLASSIFY_FRONT) {
                    frontTriangles.push(triangle);
                }
                else if (side === CLASSIFY_BACK) {
                    backTriangles.push(triangle);
                }
                else {
                    BSPNode.splitTriangle(triangle, this.divider, frontTriangles, backTriangles);
                }
            }
            if (frontTriangles.length) {
                if (this.front === undefined) {
                    this.front = new BSPNode(frontTriangles);
                }
                else {
                    this.front.addTriangles(frontTriangles);
                }
            }
            if (backTriangles.length) {
                if (this.back === undefined) {
                    this.back = new BSPNode(backTriangles);
                }
                else {
                    this.back.addTriangles(backTriangles);
                }
            }
        }
        invert() {
            this.isInverted = !this.isInverted;
            if (this.divider !== undefined)
                this.divider.invert();
            if (this.front !== undefined)
                this.front.invert();
            if (this.back !== undefined)
                this.back.invert();
            const temp = this.front;
            this.front = this.back;
            this.back = temp;
            for (let i = 0; i < this.triangles.length; i++) {
                this.triangles[i].invert();
            }
        }
        // Remove all triangles in this BSP tree that are inside the other BSP tree
        clipTo(tree) {
            this.triangles = tree.clipTriangles(this.triangles);
            if (this.front !== undefined)
                this.front.clipTo(tree);
            if (this.back !== undefined)
                this.back.clipTo(tree);
        }
        // Recursively remove all triangles from `triangles` that are inside this BSP tree
        clipTriangles(triangles) {
            if (!this.divider)
                return triangles.slice();
            let frontTriangles = [];
            let backTriangles = [];
            if (this.front === undefined && this.back === undefined) {
                triangles = triangles.slice();
                // this is a leaf node and thus a convex set, return any triangles not contained by the set
                outer: for (let i = 0; i < triangles.length; i++) {
                    const candidate = triangles[i];
                    let backsideCount = 0;
                    let frontsideCount = 0;
                    for (let j = 0; j < this.triangles.length; j++) {
                        const side = this.triangles[j].classifySide(candidate);
                        if (side === CLASSIFY_BACK) {
                            backsideCount++;
                        }
                        else if (side === CLASSIFY_FRONT) {
                            frontsideCount++;
                        }
                        else if (side === CLASSIFY_COPLANAR) {
                            // keep coplanar triangles if they face the correct direction
                            const dot = this.triangles[j].normal.dot(candidate.normal);
                            if (dot < 0) {
                                backsideCount++;
                            }
                            else {
                                frontsideCount++;
                            }
                        }
                        else if (side === CLASSIFY_SPANNING) {
                            // exclude this triangle as it becomes split,
                            // push resulting front triangles into `triangles` for more splitting
                            BSPNode.splitTriangle(candidate, this.triangles[j], triangles, triangles);
                            continue outer;
                        }
                    }
                    if (!this.isInverted && backsideCount !== this.triangles.length) {
                        frontTriangles.push(candidate);
                    }
                    else if (this.isInverted && frontsideCount === this.triangles.length) {
                        frontTriangles.push(candidate);
                    }
                }
                return frontTriangles;
            }
            // not a leaf node / convex set
            for (let i = 0; i < triangles.length; i++) {
                const triangle = triangles[i];
                const side = this.divider.classifySide(triangle);
                if (side === CLASSIFY_FRONT) {
                    frontTriangles.push(triangle);
                }
                else if (side === CLASSIFY_BACK) {
                    backTriangles.push(triangle);
                }
                else if (side == CLASSIFY_COPLANAR) {
                    const dot = this.divider.normal.dot(triangle.normal);
                    if (dot > 0) {
                        frontTriangles.push(triangle);
                    }
                    else {
                        backTriangles.push(triangle);
                    }
                }
                else if (side === CLASSIFY_SPANNING) {
                    BSPNode.splitTriangle(triangle, this.divider, frontTriangles, backTriangles);
                }
            }
            if (this.front !== undefined)
                frontTriangles = this.front.clipTriangles(frontTriangles);
            if (this.back !== undefined) {
                backTriangles = this.back.clipTriangles(backTriangles);
            }
            else {
                backTriangles = [];
            }
            return frontTriangles.concat(backTriangles);
        }
        getTriangles() {
            let triangles = this.triangles.slice();
            if (this.front !== undefined)
                triangles = triangles.concat(this.front.getTriangles());
            if (this.back !== undefined)
                triangles = triangles.concat(this.back.getTriangles());
            return triangles;
        }
        clone() {
            const clone = new BSPNode();
            clone.isInverted = this.isInverted;
            if (this.divider !== undefined)
                clone.divider = this.divider.clone();
            if (this.front !== undefined)
                clone.front = this.front.clone();
            if (this.back !== undefined)
                clone.back = this.back.clone();
            const clonedTriangles = [];
            for (let i = 0; i < this.triangles.length; i++) {
                clonedTriangles.push(this.triangles[i].clone());
            }
            clone.triangles = clonedTriangles;
            return clone;
        }
        toGeometry() {
            const geometry = new three.Geometry();
            const triangles = this.getTriangles();
            for (let i = 0; i < triangles.length; i++) {
                const triangle = triangles[i];
                const vertexIndex = geometry.vertices.length;
                geometry.vertices.push(triangle.a, triangle.b, triangle.c);
                const face = new three.Face3(vertexIndex, vertexIndex + 1, vertexIndex + 2, triangle.normal);
                geometry.faces.push(face);
            }
            return geometry;
        }
    }
    BSPNode.splitTriangle = function splitTriangle(triangle, divider, frontTriangles, backTriangles) {
        const vertices = [triangle.a, triangle.b, triangle.c];
        const frontVertices = [];
        const backVertices = [];
        for (let i = 0; i < 3; i++) {
            const j = (i + 1) % 3;
            const vi = vertices[i];
            const vj = vertices[j];
            const ti = divider.classifyPoint(vi);
            const tj = divider.classifyPoint(vj);
            if (ti != CLASSIFY_BACK)
                frontVertices.push(vi);
            if (ti != CLASSIFY_FRONT)
                backVertices.push(vi);
            if ((ti | tj) === CLASSIFY_SPANNING) {
                const t = (divider.w - divider.normal.dot(vi)) / divider.normal.dot(vj.clone().sub(vi));
                const v = BSPNode.interpolateVectors(vi, vj, t);
                frontVertices.push(v);
                backVertices.push(v);
            }
        }
        if (frontVertices.length >= 3)
            Array.prototype.push.apply(frontTriangles, BSPNode.verticesToTriangles(frontVertices));
        if (backVertices.length >= 3)
            Array.prototype.push.apply(backTriangles, BSPNode.verticesToTriangles(backVertices));
    };

    function convertMeshToTriangles(mesh) {
        if (isBufferGeometry(mesh.geometry)) {
            throw new Error(' Only meshes with Three.Geometry are supported.');
        }
        const triangles = [];
        mesh.updateMatrixWorld(true);
        const { matrixWorld: transform } = mesh;
        const { geometry: { faces, vertices } } = mesh;
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            const a = vertices[face.a].clone();
            const b = vertices[face.b].clone();
            const c = vertices[face.c].clone();
            a.applyMatrix4(transform);
            b.applyMatrix4(transform);
            c.applyMatrix4(transform);
            const triangle = new Triangle(a, b, c);
            triangles.push(triangle);
        }
        return triangles;
    }

    function intersect(a, b) {
        a = a.clone();
        b = b.clone();
        a.invert();
        b.clipTo(a);
        b.invert();
        a.clipTo(b);
        b.clipTo(a);
        a.invert();
        b.invert();
        return new BSPNode(a.getTriangles().concat(b.getTriangles()));
    }
    function union(a, b) {
        a = a.clone();
        b = b.clone();
        a.clipTo(b);
        b.clipTo(a);
        b.invert();
        b.clipTo(a);
        b.invert();
        return new BSPNode(a.getTriangles().concat(b.getTriangles()));
    }
    function subtract(a, b) {
        a = a.clone();
        b = b.clone();
        a.invert();
        b.clipTo(a);
        a.clipTo(b);
        b.invert();
        b.clipTo(a);
        a.invert();
        return new BSPNode(a.getTriangles().concat(b.getTriangles()));
    }

    var boolean = /*#__PURE__*/Object.freeze({
        intersect: intersect,
        union: union,
        subtract: subtract
    });

    function geometryToMesh(geometry, material) {
        // center geometry & apply position to a new mesh
        geometry.computeBoundingBox();
        const offset = new three.Vector3();
        geometry.boundingBox.getCenter(offset);
        geometry.translate(-offset.x, -offset.y, -offset.z);
        const mesh = new three.Mesh(geometry, material);
        mesh.position.copy(offset);
        return mesh;
    }
    function subtract$1(mesh1, mesh2, material) {
        const bsp1 = new BSPNode(convertMeshToTriangles(mesh1));
        const bsp2 = new BSPNode(convertMeshToTriangles(mesh2));
        const geometry = subtract(bsp1, bsp2).toGeometry();
        return geometryToMesh(geometry, material);
    }
    function union$1(mesh1, mesh2, material) {
        const bsp1 = new BSPNode(convertMeshToTriangles(mesh1));
        const bsp2 = new BSPNode(convertMeshToTriangles(mesh2));
        const geometry = union(bsp1, bsp2).toGeometry();
        return geometryToMesh(geometry, material);
    }
    function intersect$1(mesh1, mesh2, material) {
        const bsp1 = new BSPNode(convertMeshToTriangles(mesh1));
        const bsp2 = new BSPNode(convertMeshToTriangles(mesh2));
        const geometry = intersect(bsp1, bsp2).toGeometry();
        return geometryToMesh(geometry, material);
    }

    exports.BSPNode = BSPNode;
    exports.convertMeshToTriangles = convertMeshToTriangles;
    exports.boolean = boolean;
    exports.subtract = subtract$1;
    exports.union = union$1;
    exports.intersect = intersect$1;

    Object.defineProperty(exports, '__esModule', { value: true });

}));
