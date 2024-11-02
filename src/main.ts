import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

class InfiniteRacer {
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private renderer!: THREE.WebGLRenderer;
    private car!: THREE.Group;
    
    // Track properties
    private trackSegments: THREE.Group[] = [];
    private segmentLength: number = 100;
    private visibleSegments: number = 7;
    private lastSegmentZ: number = 0;
    
    // Movement properties
    private speed: number = 0;
    private maxSpeed: number = 3;
    private boostMultiplier: number = 2;
    private carRotation: number = 0;
    
    // Control state
    private moveControls = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        boost: false
    };

    private orbitControls!: OrbitControls;
    private isOrbitMode: boolean = false;

    // Add these properties to the class
    private lateralVelocity: number = 0;
    private driftFactor: number = 0.98;
    private turnSpeed: number = 0.0125;
    private rotationalInertia: number = 0;
    private maxRotationalSpeed: number = 0.03;
    private turnResponsiveness: number = 0.8;

    // Add these properties
    private trackPoints: THREE.Vector3[] = [];
    private trackCurve!: THREE.CurvePath<THREE.Vector3>;
    private trackWidth: number = 30;
    private trackLength: number = 2000; // Circumference of track

    // Add these properties
    private isBoosting: boolean = false;
    private normalMaxSpeed: number = 2;
    private boostMaxSpeed: number = 10;  // 5x normal speed
    private boostParticles: THREE.Mesh[] = [];

    // Add these properties
    private objects: THREE.Object3D[] = [];  // Store collidable objects
    private isVibrating: boolean = false;
    private vibrationTime: number = 0;
    private spawnPoint: THREE.Vector3 = new THREE.Vector3(0, 0.5, 0);
    private boundarySize: number = 500; // Half of the plane size
    private vibrationIntensity: number = 0.1;
    private vibrationDuration: number = 1000; // in milliseconds

    private menu!: HTMLDivElement;
    private isMenuOpen: boolean = false;

    private menuIndicator!: HTMLDivElement;

    // Add this helper method for more precise collision detection
    private checkCollision(carPosition: THREE.Vector3, treePosition: THREE.Vector3): boolean {
        // Define collision radius
        const treeRadius = 1.5;  // Reduced from 3
        const carRadius = 1.0;   // Approximate car width/2
        
        // Calculate distance between car and tree centers
        const dx = carPosition.x - treePosition.x;
        const dz = carPosition.z - treePosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        // Return true if objects are touching
        return distance < (treeRadius + carRadius);
    }

    // Update the car movement method to allow free movement
    private updateCarMovement(): void {
        if (!this.car) return;

        // Store previous position for collision response
        const previousPosition = this.car.position.clone();

        // Update max speed based on boost
        const currentMaxSpeed = this.isBoosting ? this.boostMaxSpeed : this.normalMaxSpeed;

        // Update speed based on acceleration/braking
        if (this.isAccelerating) {
            this.speed = Math.min(this.speed + this.acceleration, currentMaxSpeed);
            
            // Create boost effect when boosting and moving forward
            if (this.isBoosting && this.speed > this.normalMaxSpeed) {
                this.createBoostEffect();
            }
        } else if (this.isBraking) {
            this.speed = Math.max(this.speed - this.acceleration * 2, -currentMaxSpeed/2);
        } else {
            // Apply friction/deceleration
            if (Math.abs(this.speed) > 0.01) {
                this.speed *= 0.95;
            } else {
                this.speed = 0;
            }
        }

        // Update rotation based on turning
        if (this.isTurningLeft) {
            this.car.rotation.y += this.turnSpeed * (Math.abs(this.speed) / this.maxSpeed);
        }
        if (this.isTurningRight) {
            this.car.rotation.y -= this.turnSpeed * (Math.abs(this.speed) / this.maxSpeed);
        }

        // Calculate forward movement based on car's rotation
        const moveDistance = this.speed * 0.16;
        this.car.position.x += Math.sin(this.car.rotation.y) * moveDistance;
        this.car.position.z += Math.cos(this.car.rotation.y) * moveDistance;

        // Update camera based on mode
        if (!this.isOrbitMode) {
            // Normal following camera
            const cameraOffset = new THREE.Vector3(
                -Math.sin(this.car.rotation.y) * 15,
                7,
                -Math.cos(this.car.rotation.y) * 15
            );
            this.camera.position.lerp(this.car.position.clone().add(cameraOffset), 0.1);
            this.camera.lookAt(
                new THREE.Vector3(
                    this.car.position.x + Math.sin(this.car.rotation.y) * 10,
                    this.car.position.y,
                    this.car.position.z + Math.cos(this.car.rotation.y) * 10
                )
            );
            
            // Make sure orbit controls are disabled
            this.orbitControls.enabled = false;
        } else {
            // Orbit camera mode
            this.orbitControls.enabled = true;
            this.orbitControls.target.copy(this.car.position);
            this.orbitControls.update();
        }

        // Clean up old boost particles
        this.boostParticles = this.boostParticles.filter(particle => {
            const material = particle.material as THREE.MeshBasicMaterial;
            material.opacity -= 0.15;  // Faster fade
            particle.scale.multiplyScalar(0.95);  // Shrink effect
            if (material.opacity <= 0) {
                this.scene.remove(particle);
                return false;
            }
            return true;
        });

        // Check boundary
        if (Math.abs(this.car.position.x) > this.boundarySize || 
            Math.abs(this.car.position.z) > this.boundarySize) {
            this.respawnCar();
            return;
        }

        // Check collisions with improved precision
        let collision = false;
        for (const object of this.objects) {
            if (this.checkCollision(this.car.position, object.position)) {
                collision = true;
                // Collision response
                this.car.position.copy(previousPosition);
                this.speed = -this.speed * 0.5; // Bounce back
                this.startVibration();
                break;
            }
        }

        // Handle vibration
        if (this.isVibrating) {
            const now = Date.now();
            if (now - this.vibrationTime < this.vibrationDuration) {
                this.car.position.x += (Math.random() - 0.5) * this.vibrationIntensity;
                this.car.position.y += (Math.random() - 0.5) * this.vibrationIntensity;
            } else {
                this.isVibrating = false;
            }
        }
    }

    // Update car properties for better control
    private acceleration: number = 0.1;     // Adjusted acceleration
    private deceleration: number = 0.05;    // Added deceleration

    // Add these properties if they don't exist
    private isAccelerating: boolean = false;
    private isBraking: boolean = false;
    private isTurningLeft: boolean = false;
    private isTurningRight: boolean = false;

    // Make sure you have these keyboard event listeners
    private initEventListeners(): void {
        // Bind the event handlers to this instance
        document.addEventListener('keydown', (event) => this.handleKeyDown(event));
        document.addEventListener('keyup', (event) => this.handleKeyUp(event));
        
        // Add orbit controls if you're using them
        if (this.orbitControls) {
            this.orbitControls.enableDamping = true;
            this.orbitControls.dampingFactor = 0.05;
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') {
                event.preventDefault(); // Prevent default tab behavior
                this.toggleMenu();
            }
        });
    }

    private handleKeyDown(event: KeyboardEvent): void {
        switch (event.key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                this.isAccelerating = true;
                break;
            case 's':
            case 'arrowdown':
                this.isBraking = true;
                break;
            case 'a':
            case 'arrowleft':
                this.isTurningLeft = true;
                break;
            case 'd':
            case 'arrowright':
                this.isTurningRight = true;
                break;
            case 'c':
                this.isOrbitMode = !this.isOrbitMode;
                if (this.isOrbitMode) {
                    // Set initial orbit camera position
                    const currentOffset = new THREE.Vector3(
                        -Math.sin(this.car.rotation.y) * 15,
                        7,
                        -Math.cos(this.car.rotation.y) * 15
                    );
                    this.camera.position.copy(this.car.position.clone().add(currentOffset));
                    this.orbitControls.target.copy(this.car.position);
                }
                break;
            case 'shift':
                this.isBoosting = true;
                break;
        }
    }

    private handleKeyUp(event: KeyboardEvent): void {
        switch (event.key.toLowerCase()) {
            case 'w':
            case 'arrowup':
                this.isAccelerating = false;
                break;
            case 's':
            case 'arrowdown':
                this.isBraking = false;
                break;
            case 'a':
            case 'arrowleft':
                this.isTurningLeft = false;
                break;
            case 'd':
            case 'arrowright':
                this.isTurningRight = false;
                break;
            case 'shift':
                this.isBoosting = false;
                break;
        }
    }

    constructor() {
        this.initScene();
        this.initLights();
        this.createRaceTrack();
        this.loadCarModel();
        this.createMenuIndicator();
        this.createMenu();
        this.initEventListeners();
        this.animate();
    }

    private initScene(): void {
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);
        this.scene.fog = new THREE.Fog(0x87CEEB, 100, 300);

        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            powerPreference: "high-performance"
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        // Camera setup
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            1000
        );
        this.camera.position.set(0, 10, -20);
        this.camera.lookAt(0, 0, 0);    

        // Add orbit controls
        this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.minDistance = 3;
        this.orbitControls.maxDistance = 20;
        this.orbitControls.enabled = false; // Start in drive mode

        // Enable performance optimizations
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // Better performance than PCFShadowMap
        
        // Optimize shadow settings
        const shadowSize = 1024;  // Reduced from default
        this.renderer.shadowMap.autoUpdate = false;  // Manual shadow updates
        this.renderer.shadowMap.needsUpdate = true;
    }

    private initLights(): void {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        // Directional light (sun)
        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(100, 100, 50);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 1;
        dirLight.shadow.camera.far = 500;
        dirLight.shadow.camera.left = -100;
        dirLight.shadow.camera.right = 100;
        dirLight.shadow.camera.top = 100;
        dirLight.shadow.camera.bottom = -100;
        this.scene.add(dirLight);
    }

    private createTrackSegment(zPosition: number): THREE.Group {
        const segment = new THREE.Group();

        // Increase ground width significantly
        const groundWidth = 200;  // Increased from previous value
        const roadWidth = 30;     // Keep road width the same

        // Ground
        const groundGeometry = new THREE.PlaneGeometry(groundWidth, this.segmentLength);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d5e1e,
            roughness: 0.8
        });
        const ground = new THREE.Mesh(groundGeometry, groundMaterial);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;

        // Road
        const roadGeometry = new THREE.PlaneGeometry(roadWidth, this.segmentLength);
        const roadMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.8
        });
        const road = new THREE.Mesh(roadGeometry, roadMaterial);
        road.rotation.x = -Math.PI / 2;
        road.position.y = 0.01;
        road.receiveShadow = true;

        // Add fences
        const fenceHeight = 3;
        const fenceGeometry = new THREE.BoxGeometry(0.3, fenceHeight, this.segmentLength);
        const fenceMaterial = new THREE.MeshStandardMaterial({
            color: 0x808080,
            metalness: 0.7,
            roughness: 0.3
        });

        // Left fence
        const leftFence = new THREE.Mesh(fenceGeometry, fenceMaterial);
        leftFence.position.set(-roadWidth/2, fenceHeight/2, 0);
        leftFence.castShadow = true;
        leftFence.receiveShadow = true;

        // Right fence
        const rightFence = new THREE.Mesh(fenceGeometry, fenceMaterial);
        rightFence.position.set(roadWidth/2, fenceHeight/2, 0);
        rightFence.castShadow = true;
        rightFence.receiveShadow = true;

        // Add fence posts
        const postGeometry = new THREE.BoxGeometry(0.3, fenceHeight, 0.3);
        const postMaterial = new THREE.MeshStandardMaterial({
            color: 0x606060,
            metalness: 0.8,
            roughness: 0.2
        });

        // Add posts every 10 units
        for (let i = -this.segmentLength/2; i <= this.segmentLength/2; i += 10) {
            // Left posts
            const leftPost = new THREE.Mesh(postGeometry, postMaterial);
            leftPost.position.set(-roadWidth/2, fenceHeight/2, i);
            leftPost.castShadow = true;
            leftPost.receiveShadow = true;
            segment.add(leftPost);

            // Right posts
            const rightPost = new THREE.Mesh(postGeometry, postMaterial);
            rightPost.position.set(roadWidth/2, fenceHeight/2, i);
            rightPost.castShadow = true;
            rightPost.receiveShadow = true;
            segment.add(rightPost);
        }

        // Add road lines
        const lineWidth = 0.3;
        const lineLength = 5;
        const lineGap = 5;
        const lineMaterial = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });

        // Center line (dashed)
        for (let i = -this.segmentLength/2; i <= this.segmentLength/2; i += lineLength + lineGap) {
            const centerLine = new THREE.Mesh(
                new THREE.PlaneGeometry(lineWidth, lineLength),
                lineMaterial
            );
            centerLine.rotation.x = -Math.PI / 2;
            centerLine.position.set(0, 0.02, i);
            segment.add(centerLine);
        }

        // Solid side lines
        const leftLine = new THREE.Mesh(
            new THREE.PlaneGeometry(lineWidth, this.segmentLength),
            lineMaterial
        );
        leftLine.rotation.x = -Math.PI / 2;
        leftLine.position.set(-roadWidth/2 + 1, 0.02, 0);
        segment.add(leftLine);

        const rightLine = new THREE.Mesh(
            new THREE.PlaneGeometry(lineWidth, this.segmentLength),
            lineMaterial
        );
        rightLine.rotation.x = -Math.PI / 2;
        rightLine.position.set(roadWidth/2 - 1, 0.02, 0);
        segment.add(rightLine);

        segment.add(ground);
        segment.add(road);
        segment.add(leftFence);
        segment.add(rightFence);
        segment.position.z = zPosition;

        return segment;
    }

    private initTrack(): void {
        for (let i = 0; i < this.visibleSegments; i++) {
            const segment = this.createTrackSegment(this.lastSegmentZ);
            this.trackSegments.push(segment);
            this.scene.add(segment);
            this.lastSegmentZ += this.segmentLength;
        }
    }

    private loadCarModel(): void {
        const loader = new GLTFLoader();
        loader.load(
            '/models/car.glb',
            (gltf) => {
                this.car = gltf.scene;
                const carScale = 0.02;
                this.car.scale.set(carScale, carScale, carScale);
                this.car.position.set(0, 0.5, 0);
                this.car.rotation.y = 0;
                this.car.castShadow = true;
                this.scene.add(this.car);
            },
            undefined,
            (error) => {
                console.error('Error loading car:', error);
            }
        );
    }

    private toggleCameraMode(event: KeyboardEvent): void {
        if (event.key === 'c' || event.key === 'C') {
            this.isOrbitMode = !this.isOrbitMode;
            this.orbitControls.enabled = this.isOrbitMode;
            
            if (this.car) {
                if (this.isOrbitMode) {
                    // Set orbit controls target to car position
                    this.orbitControls.target.copy(this.car.position);
                } else {
                    // Reset to driving camera
                    const cameraOffset = new THREE.Vector3(
                        Math.sin(this.carRotation) * -15,
                        7,
                        Math.cos(this.carRotation) * -15
                    );
                    this.camera.position.copy(this.car.position).add(cameraOffset);
                    this.camera.lookAt(this.car.position);
                }
            }
        }
    }

    private createMenu(): void {
        // Create menu element
        this.menu = document.createElement('div');
        this.menu.className = 'game-menu';
        this.menu.style.display = 'none';
        
        this.menu.innerHTML = `
            <div class="menu-content">
                <h2>Controls</h2>
                <ul>
                    <li><span class="key">W</span> or <span class="key">↑</span> - Accelerate</li>
                    <li><span class="key">S</span> or <span class="key">↓</span> - Brake/Reverse</li>
                    <li><span class="key">A</span> or <span class="key">←</span> - Turn Left</li>
                    <li><span class="key">D</span> or <span class="key">→</span> - Turn Right</li>
                    <li><span class="key">SHIFT</span> - Boost</li>
                    <li><span class="key">C</span> - Toggle Camera Mode</li>
                    <li><span class="key">TAB</span> - Toggle Menu</li>
                </ul>
                <p class="tip">Press TAB to close</p>
            </div>
        `;
        
        document.body.appendChild(this.menu);
    }

    private toggleMenu(): void {
        this.isMenuOpen = !this.isMenuOpen;
        this.menu.style.display = this.isMenuOpen ? 'block' : 'none';
        this.menuIndicator.classList.toggle('hidden', this.isMenuOpen);
    }

    private animate(): void {
        requestAnimationFrame(() => this.animate());
        
        this.updateCarMovement();
        
        // Update orbit controls if enabled
        if (this.isOrbitMode) {
            this.orbitControls.update();
        }
        
        this.renderer.render(this.scene, this.camera);
    }

    private createRaceTrack(): void {
        // Create main plane (asphalt)
        const planeGeometry = new THREE.PlaneGeometry(1000, 1000);
        const planeMaterial = new THREE.MeshStandardMaterial({
            color: 0x333333,
            roughness: 0.8,
            side: THREE.DoubleSide
        });
        
        const plane = new THREE.Mesh(planeGeometry, planeMaterial);
        plane.rotation.x = -Math.PI / 2;
        plane.position.y = 0;
        plane.receiveShadow = true;
        this.scene.add(plane);

        // Add road stripes
        const stripeGeometry = new THREE.PlaneGeometry(5, 15);
        const stripeMaterial = new THREE.MeshStandardMaterial({
            color: 0xFFFFFF,
            roughness: 0.5,
            side: THREE.DoubleSide
        });

        // Create multiple stripes
        for (let z = -500; z < 500; z += 30) {
            const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
            stripe.rotation.x = -Math.PI / 2;
            stripe.position.set(0, 0.01, z);  // Slightly above road
            this.scene.add(stripe);
        }

        // Add trees
        const treeGeometry = new THREE.ConeGeometry(5, 20, 8);
        const treeMaterial = new THREE.MeshStandardMaterial({
            color: 0x2d5a27,  // Dark green
            roughness: 0.8
        });
        const trunkGeometry = new THREE.CylinderGeometry(1, 1, 7);
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x4d2926,  // Brown
            roughness: 1
        });

        // Create trees randomly
        for (let i = 0; i < 100; i++) {
            const tree = new THREE.Group();

            // Create smaller invisible collision cylinder
            const collisionGeometry = new THREE.CylinderGeometry(1.5, 1.5, 20); // Reduced radius
            const collisionMaterial = new THREE.MeshBasicMaterial({ 
                visible: false 
            });
            const collision = new THREE.Mesh(collisionGeometry, collisionMaterial);
            collision.position.y = 10;
            tree.add(collision);

            // Tree top
            const treeTop = new THREE.Mesh(treeGeometry, treeMaterial);
            treeTop.position.y = 13;
            treeTop.castShadow = true;
            tree.add(treeTop);

            // Trunk
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.y = 3;
            trunk.castShadow = true;
            tree.add(trunk);

            // Random position
            const x = Math.random() > 0.5 ? 
                Math.random() * 200 + 50 :  // Right side
                Math.random() * -200 - 50;  // Left side
            const z = Math.random() * 1000 - 500;

            tree.position.set(x, 0, z);
            this.objects.push(tree); // Add to collidable objects
            this.scene.add(tree);
        }

        // Add grass patches
        const grassGeometry = new THREE.CircleGeometry(3, 6);
        const grassMaterial = new THREE.MeshStandardMaterial({
            color: 0x3d8c40,  // Grass green
            roughness: 1,
            side: THREE.DoubleSide
        });

        // Create random grass patches
        for (let i = 0; i < 500; i++) {
            const grass = new THREE.Mesh(grassGeometry, grassMaterial);
            grass.rotation.x = -Math.PI / 2;
            
            // Random position (avoiding road)
            const x = Math.random() > 0.5 ? 
                Math.random() * 400 + 30 :   // Right side
                Math.random() * -400 - 30;   // Left side
            const z = Math.random() * 1000 - 500;
            
            grass.position.set(x, 0.01, z);  // Slightly above ground
            grass.rotation.z = Math.random() * Math.PI; // Random rotation
            grass.scale.set(
                0.5 + Math.random() * 1,     // Random size
                0.5 + Math.random() * 1,
                1
            );
            this.scene.add(grass);
        }
    }

    // Update camera to follow car smoothly
    private updateCamera(): void {
        if (!this.car || this.isOrbitMode) return;
        
        const cameraOffset = new THREE.Vector3(0, 5, -10);
        const cameraPosition = this.car.position.clone().add(cameraOffset);
        this.camera.position.lerp(cameraPosition, 0.1);
        this.camera.lookAt(this.car.position);
    }

    // Add method to create boost effect
    private createBoostEffect(): void {
        // Create smaller flame geometry
        const flameGeometry = new THREE.ConeGeometry(0.15, 1, 8);
        const flameMaterial = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.8
        });

        // Create two flames for dual exhaust
        const leftFlame = new THREE.Mesh(flameGeometry, flameMaterial.clone());
        const rightFlame = new THREE.Mesh(flameGeometry, flameMaterial.clone());

        // Rotate flames to point backwards
        leftFlame.rotation.x = Math.PI;
        rightFlame.rotation.x = Math.PI;

        // Adjusted position values
        const backOffsetLeft = 1.2;   // Left flame distance behind car
        const backOffsetRight = 1.0;  // Right flame slightly closer to car
        const sideOffsetLeft = 0.4;   // Left flame distance from center
        const sideOffsetRight = 0.35; // Right flame slightly closer to center
        const heightOffset = 0.3;     // Height from ground

        // Left flame position
        const leftOffset = new THREE.Vector3(
            -Math.sin(this.car.rotation.y) * backOffsetLeft - Math.cos(this.car.rotation.y) * sideOffsetLeft,
            heightOffset,
            -Math.cos(this.car.rotation.y) * backOffsetLeft + Math.sin(this.car.rotation.y) * sideOffsetLeft
        );
        leftFlame.position.copy(this.car.position.clone().add(leftOffset));
        leftFlame.rotation.y = this.car.rotation.y;

        // Right flame position (closer to car)
        const rightOffset = new THREE.Vector3(
            -Math.sin(this.car.rotation.y) * backOffsetRight + Math.cos(this.car.rotation.y) * sideOffsetRight,
            heightOffset,
            -Math.cos(this.car.rotation.y) * backOffsetRight - Math.sin(this.car.rotation.y) * sideOffsetRight
        );
        rightFlame.position.copy(this.car.position.clone().add(rightOffset));
        rightFlame.rotation.y = this.car.rotation.y;

        // Add random flicker effect
        const flickerMin = 0.8;
        const flickerMax = 0.4;
        leftFlame.scale.set(
            flickerMin + Math.random() * flickerMax,
            flickerMin + Math.random() * flickerMax,
            1
        );
        rightFlame.scale.set(
            flickerMin + Math.random() * flickerMax,
            flickerMin + Math.random() * flickerMax,
            1
        );

        this.boostParticles.push(leftFlame, rightFlame);
        this.scene.add(leftFlame, rightFlame);

        // Remove old particles
        while (this.boostParticles.length > 12) {
            const oldFlame = this.boostParticles.shift();
            if (oldFlame) {
                this.scene.remove(oldFlame);
            }
        }
    }

    private startVibration(): void {
        this.isVibrating = true;
        this.vibrationTime = Date.now();
    }

    private respawnCar(): void {
        this.car.position.copy(this.spawnPoint);
        this.car.rotation.set(0, 0, 0);
        this.speed = 0;
        this.isVibrating = false;
    }

    private createMenuIndicator(): void {
        this.menuIndicator = document.createElement('div');
        this.menuIndicator.className = 'menu-indicator';
        this.menuIndicator.innerHTML = `
            <span class="menu-text">Menu</span>
            <span class="key">TAB</span>
        `;
        document.body.appendChild(this.menuIndicator);
    }
}

// Start the game
new InfiniteRacer();
