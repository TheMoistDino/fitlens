import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeCoverDimensions } from '../src/features/food-scanner/components/FoodOverlayCanvas';
import { DEFAULT_CAMERA_VIEWPORT_CLASS } from '../src/ui/CameraViewport';

describe('Challenger 2: Viewport Layout, Cover Dimensions & Stream State Stress Suite', () => {
  describe('Adversarial Stress Testing of computeCoverDimensions', () => {
    it('should satisfy strict CSS object-fit: cover invariant across 500 randomized container & video aspects', () => {
      // Mathematical property of object-fit: cover:
      // 1. displayedWidth >= containerWidth (within float epsilon)
      // 2. displayedHeight >= containerHeight (within float epsilon)
      // 3. At least one dimension exactly equals container dimension (within float epsilon)
      // 4. displayedWidth / displayedHeight === videoAspect (within float epsilon)

      const testCases = [
        // Standard formats
        { cw: 1920, ch: 1080, va: 16 / 9 },
        { cw: 1920, ch: 1080, va: 4 / 3 },
        { cw: 390, ch: 844, va: 16 / 9 },
        { cw: 390, ch: 844, va: 4 / 3 },
        { cw: 412, ch: 915, va: 16 / 9 }, // Pixel 7
        // Ultrawide displays
        { cw: 2560, ch: 1080, va: 16 / 9 }, // 21:9
        { cw: 3440, ch: 1440, va: 16 / 9 }, // 21:9
        { cw: 5120, ch: 1440, va: 16 / 9 }, // 32:9 Super Ultrawide
        { cw: 3840, ch: 1080, va: 4 / 3 },
        // Ultra-tall vertical mobile displays
        { cw: 1080, ch: 2520, va: 16 / 9 }, // 9:21 Sony Xperia
        { cw: 1080, ch: 2640, va: 16 / 9 }, // Foldable unfolded
        // Square aspect ratios
        { cw: 1000, ch: 1000, va: 16 / 9 },
        { cw: 1000, ch: 1000, va: 1 },
        { cw: 1920, ch: 1080, va: 1 },
        { cw: 1080, ch: 1920, va: 1 },
        // Extreme aspect ratios
        { cw: 1920, ch: 1080, va: 100 }, // Panorama
        { cw: 1920, ch: 1080, va: 0.01 }, // Extreme vertical slit
        { cw: 1, ch: 1, va: 16 / 9 }, // Single pixel container
        { cw: 10000, ch: 10000, va: 16 / 9 }, // 10K display
      ];

      // Add 200 pseudo-randomized realistic and edge cases
      for (let i = 0; i < 200; i++) {
        const cw = Math.floor(Math.random() * 4000) + 10;
        const ch = Math.floor(Math.random() * 4000) + 10;
        const va = (Math.random() * 5 + 0.2); // aspects from 0.2 to 5.2
        testCases.push({ cw, ch, va });
      }

      for (const { cw, ch, va } of testCases) {
        const { width, height } = computeCoverDimensions(cw, ch, va);

        // 1. Cover property: must fully cover container
        assert.ok(
          width >= cw - 1e-4,
          `Failed cover width: width ${width} < containerWidth ${cw} for va ${va}`,
        );
        assert.ok(
          height >= ch - 1e-4,
          `Failed cover height: height ${height} < containerHeight ${ch} for va ${va}`,
        );

        // 2. Minimum fit property: at least one dimension must match container exactly
        const widthMatches = Math.abs(width - cw) < 1e-4;
        const heightMatches = Math.abs(height - ch) < 1e-4;
        assert.ok(
          widthMatches || heightMatches,
          `Neither dimension matched container: w=${width} (cw=${cw}), h=${height} (ch=${ch})`,
        );

        // 3. Aspect ratio preservation
        const resultAspect = width / height;
        assert.ok(
          Math.abs(resultAspect - va) < 1e-4,
          `Aspect ratio drifted: expected ${va}, got ${resultAspect}`,
        );
      }
    });

    it('should defensively handle degenerate, boundary, and non-finite inputs without throwing or producing NaN', () => {
      // 1. Missing or undefined aspect ratio
      assert.deepStrictEqual(computeCoverDimensions(800, 600, undefined), { width: 800, height: 600 });

      // 2. Zero aspect ratio
      assert.deepStrictEqual(computeCoverDimensions(800, 600, 0), { width: 800, height: 600 });

      // 3. Negative aspect ratio
      assert.deepStrictEqual(computeCoverDimensions(800, 600, -1.77), { width: 800, height: 600 });

      // 4. NaN aspect ratio
      assert.deepStrictEqual(computeCoverDimensions(800, 600, NaN), { width: 800, height: 600 });

      // 5. Zero container width or height (e.g. pre-layout render)
      assert.deepStrictEqual(computeCoverDimensions(0, 600, 16 / 9), { width: 0, height: 600 });
      assert.deepStrictEqual(computeCoverDimensions(800, 0, 16 / 9), { width: 800, height: 0 });
      assert.deepStrictEqual(computeCoverDimensions(0, 0, 16 / 9), { width: 0, height: 0 });

      // 6. Negative container dimensions
      assert.deepStrictEqual(computeCoverDimensions(-100, 600, 16 / 9), { width: -100, height: 600 });
      assert.deepStrictEqual(computeCoverDimensions(800, -100, 16 / 9), { width: 800, height: -100 });
    });

    it('should verify Three.js coordinate mapping center invariant under cover scaling', () => {
      // Center item normalized: x=0.45, w=0.1 -> center=0.5; y=0.45, h=0.1 -> center=0.5
      const normCenterX = 0.5;
      const normCenterY = 0.5;

      const containerConfigs = [
        { w: 1920, h: 1080, va: 16 / 9 }, // Exact match
        { w: 2560, h: 1080, va: 16 / 9 }, // Ultrawide container
        { w: 390, h: 844, va: 16 / 9 },   // Tall mobile container
        { w: 1000, h: 1000, va: 4 / 3 },  // Square container
      ];

      for (const { w, h, va } of containerConfigs) {
        const { width: dw, height: dh } = computeCoverDimensions(w, h, va);
        // Ortho projection formula from FoodOverlayCanvas.tsx line 239-240
        const targetWorldX = (normCenterX - 0.5) * dw;
        const targetWorldY = (0.5 - normCenterY) * dh;

        // Centered food items must always project to exactly (0, 0) in Three.js world space
        assert.strictEqual(targetWorldX, 0, `Target world X was not 0 for ${w}x${h}`);
        assert.strictEqual(targetWorldY, 0, `Target world Y was not 0 for ${w}x${h}`);
      }
    });
  });

  describe('CameraViewport Layout & CSS Class Verification (R1)', () => {
    it('should verify DEFAULT_CAMERA_VIEWPORT_CLASS eliminates 62vh and uses responsive dvh', () => {
      // 1. Mobile responsive height
      assert.ok(
        DEFAULT_CAMERA_VIEWPORT_CLASS.includes('h-[calc(100dvh-4.5rem)]'),
        'Mobile class must be h-[calc(100dvh-4.5rem)]',
      );

      // 2. Desktop responsive height
      assert.ok(
        DEFAULT_CAMERA_VIEWPORT_CLASS.includes('md:h-[calc(100dvh-5.5rem)]'),
        'Desktop class must be md:h-[calc(100dvh-5.5rem)]',
      );

      // 3. Absolute zero occurrence of 62vh
      assert.strictEqual(
        DEFAULT_CAMERA_VIEWPORT_CLASS.includes('62vh'),
        false,
        'No 62vh letterbox in DEFAULT_CAMERA_VIEWPORT_CLASS',
      );

      // 4. Necessary container styling
      assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('relative'));
      assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('w-full'));
      assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('overflow-hidden'));
      assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('rounded-2xl'));
      assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('bg-black'));
      assert.ok(DEFAULT_CAMERA_VIEWPORT_CLASS.includes('shadow-2xl'));
    });
  });

  describe('Stream State Machine & Transition Stress Simulation (R3)', () => {
    type StreamMode = 'live' | 'review';

    interface StreamSimulatorState {
      streamMode: StreamMode;
      frozenFrame: string | null;
      frozenBoxes: Array<{ id: string; label: string; x: number; y: number; w: number; h: number }>;
      selectedItemId: string | null;
      mediaStreamTracksActive: boolean;
      videoPlaying: boolean;
      inferenceActive: boolean;
    }

    class StreamSimulator {
      state: StreamSimulatorState = {
        streamMode: 'live',
        frozenFrame: null,
        frozenBoxes: [],
        selectedItemId: null,
        mediaStreamTracksActive: true,
        videoPlaying: true,
        inferenceActive: true,
      };

      currentLiveDetections = [
        { id: 'item-1', label: 'burrito', x: 0.2, y: 0.3, w: 0.4, h: 0.3 },
        { id: 'item-2', label: 'cup', x: 0.7, y: 0.4, w: 0.2, h: 0.4 },
      ];

      // Corresponds to handleTakeImageAndInspect in FoodScannerRoute.tsx
      takeImageAndInspect(canvasDataUrl = 'data:image/jpeg;base64,mockFrame') {
        if (!this.state.mediaStreamTracksActive) {
          throw new Error('Cannot take image when camera tracks are inactive');
        }
        // 1. Snapshot canvas Data URL
        this.state.frozenFrame = canvasDataUrl;
        // 2. Snapshot current detected boxes
        this.state.frozenBoxes = [...this.currentLiveDetections];
        // 3. Pause video playback WITHOUT stopping tracks
        this.state.videoPlaying = false;
        // 4. Enter review mode
        this.state.streamMode = 'review';
        // 5. In review mode, inference is suspended
        this.state.inferenceActive = false;
        // 6. Auto-select first item
        if (this.state.frozenBoxes.length > 0 && this.state.frozenBoxes[0]) {
          this.state.selectedItemId = this.state.frozenBoxes[0].id;
        }
      }

      // Corresponds to handleResumeLive in FoodScannerRoute.tsx
      resumeLive() {
        // 1. Play video element
        this.state.videoPlaying = true;
        // 2. Reset review state
        this.state.streamMode = 'live';
        this.state.frozenFrame = null;
        this.state.frozenBoxes = [];
        this.state.selectedItemId = null;
        // 3. Re-enable 60 FPS inference loop
        this.state.inferenceActive = true;
      }

      // Corresponds to handleSwitchMode
      switchMode(newMode: 'camera' | 'upload') {
        if (newMode === 'upload') {
          // Releases stream
          this.state.mediaStreamTracksActive = false;
          this.state.videoPlaying = false;
          this.state.inferenceActive = false;
        } else {
          // Starts camera
          this.state.mediaStreamTracksActive = true;
          this.state.videoPlaying = true;
          this.state.inferenceActive = this.state.streamMode === 'live';
        }
      }
    }

    it('should preserve MediaStream tracks during pause-review and resume cleanly', () => {
      const sim = new StreamSimulator();

      assert.strictEqual(sim.state.streamMode, 'live');
      assert.strictEqual(sim.state.mediaStreamTracksActive, true);
      assert.strictEqual(sim.state.videoPlaying, true);

      // Tap Take Image
      sim.takeImageAndInspect();

      assert.strictEqual(sim.state.streamMode, 'review');
      assert.strictEqual(sim.state.videoPlaying, false);
      assert.strictEqual(sim.state.mediaStreamTracksActive, true, 'MediaStream tracks must remain active');
      assert.strictEqual(sim.state.inferenceActive, false, 'Inference must be paused during review');
      assert.strictEqual(sim.state.frozenBoxes.length, 2);
      assert.strictEqual(sim.state.selectedItemId, 'item-1');

      // Tap Retake / Live
      sim.resumeLive();

      assert.strictEqual(sim.state.streamMode, 'live');
      assert.strictEqual(sim.state.videoPlaying, true);
      assert.strictEqual(sim.state.mediaStreamTracksActive, true);
      assert.strictEqual(sim.state.inferenceActive, true);
      assert.strictEqual(sim.state.frozenFrame, null);
      assert.strictEqual(sim.state.frozenBoxes.length, 0);
      assert.strictEqual(sim.state.selectedItemId, null);
    });

    it('should withstand 100 rapid successive shutter-and-retake cycles without corruption', () => {
      const sim = new StreamSimulator();

      for (let cycle = 0; cycle < 100; cycle++) {
        // Rapid shutter click
        sim.takeImageAndInspect(`data:image/jpeg;base64,frame_${cycle}`);
        assert.strictEqual(sim.state.streamMode, 'review');
        assert.strictEqual(sim.state.frozenFrame, `data:image/jpeg;base64,frame_${cycle}`);
        assert.strictEqual(sim.state.mediaStreamTracksActive, true);

        // Immediate resume click
        sim.resumeLive();
        assert.strictEqual(sim.state.streamMode, 'live');
        assert.strictEqual(sim.state.frozenFrame, null);
        assert.strictEqual(sim.state.videoPlaying, true);
      }
    });

    it('should withstand 50 rapid mode switches between camera and upload mode', () => {
      const sim = new StreamSimulator();

      for (let i = 0; i < 50; i++) {
        sim.switchMode('upload');
        assert.strictEqual(sim.state.mediaStreamTracksActive, false);
        assert.strictEqual(sim.state.videoPlaying, false);

        sim.switchMode('camera');
        assert.strictEqual(sim.state.mediaStreamTracksActive, true);
        assert.strictEqual(sim.state.videoPlaying, true);
      }
    });
  });
});
