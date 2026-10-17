import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isValidImageFile } from '../src/features/food-scanner/services/imageProcessor';

describe('Food Image Processor Unit Tests', () => {
  it('should accept valid image MIME types', () => {
    const validMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/gif',
    ];

    for (const mime of validMimes) {
      const mockBlob = new Blob(['fake image data'], { type: mime });
      assert.strictEqual(
        isValidImageFile(mockBlob),
        true,
        `Expected ${mime} to be accepted as a valid image`,
      );
    }
  });

  it('should reject invalid or non-image files', () => {
    const invalidMimes = [
      'application/pdf',
      'text/plain',
      'audio/mpeg',
      'video/mp4',
      'application/zip',
    ];

    for (const mime of invalidMimes) {
      const mockBlob = new Blob(['fake non-image data'], { type: mime });
      assert.strictEqual(
        isValidImageFile(mockBlob),
        false,
        `Expected ${mime} to be rejected`,
      );
    }
  });

  it('should validate by filename extension when MIME type is missing', () => {
    // Some mobile devices omit MIME type on newly taken or cached photos
    const fileWithJpegExt = new File(['fake data'], 'dinner_plate.jpg');
    assert.strictEqual(isValidImageFile(fileWithJpegExt), true);

    const fileWithPngExt = new File(['fake data'], 'lunch_salad.png');
    assert.strictEqual(isValidImageFile(fileWithPngExt), true);

    const fileWithHeicExt = new File(['fake data'], 'meal_photo.heic');
    assert.strictEqual(isValidImageFile(fileWithHeicExt), true);

    const fileWithTxtExt = new File(['fake data'], 'notes.txt');
    assert.strictEqual(isValidImageFile(fileWithTxtExt), false);
  });
});
