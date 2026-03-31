# DVYB S3 Data Cleanup Guide

After migrating from AWS to GCP, the original S3 bucket content is no longer accessible. This document lists all DVYB tables that stored S3 keys or URLs, and the cleanup actions taken.

---

## Already Handled

| Table | Action |
|-------|--------|
| `dvyb_brand_ads` | All ads set to `approvalStatus = 'pending_approval'` (hidden from Discover) |
| `dvyb_account_products` | All rows deleted |
| `dvyb_account_hidden_domain_products` | All rows deleted |

---

## Tables to DELETE (generated content & derivatives)

Run in this order to respect foreign key dependencies:

```sql
DELETE FROM dvyb_saved_ads;
DELETE FROM dvyb_extension_save_queue;
DELETE FROM dvyb_image_edits;
DELETE FROM dvyb_image_regeneration;
DELETE FROM dvyb_video_edits;
DELETE FROM dvyb_content_library;
DELETE FROM dvyb_inspiration_links;
DELETE FROM dvyb_captions;
DELETE FROM dvyb_generated_content;
DELETE FROM dvyb_domain_product_images;
DELETE FROM dvyb_assets;
```

---

## Tables to UPDATE (keep rows, clear broken S3 references)

### `dvyb_accounts`

```sql
UPDATE dvyb_accounts SET "logoS3Key" = NULL WHERE "logoS3Key" IS NOT NULL;
```

### `dvyb_context`

```sql
UPDATE dvyb_context
SET "logoUrl" = NULL,
    "additionalLogoUrls" = NULL,
    "brandImages" = NULL,
    "brandAssets" = NULL,
    "documentUrls" = NULL
WHERE "logoUrl" IS NOT NULL
   OR "additionalLogoUrls" IS NOT NULL
   OR "brandImages" IS NOT NULL
   OR "brandAssets" IS NOT NULL
   OR "documentUrls" IS NOT NULL;
```

> Clearing `dvyb_context.logoUrl` makes the frontend fall back to the default DVYB logo.

---

## Tables LEFT ALONE (external CDN URLs, not S3)

| Table | Column(s) | Source |
|-------|-----------|--------|
| `dvyb_twitter_connections` | `profileImageUrl` | Twitter CDN |
| `dvyb_google_connections` | `profilePicture` | Google CDN |
| `dvyb_affiliates` | `profilePicture` | OAuth provider |
| `dvyb_twitter_posts` | `imageUrl`, `videoUrl` | Twitter |
| `dvyb_linkedin_posts` | `mediaUrl` | LinkedIn |
| `dvyb_instagram_posts` | `mediaUrl` | Instagram |
| `dvyb_tiktok_posts` | `videoUrl`, `coverImageUrl` | TikTok |

---

## Reference: S3 Key vs Full URL by Column

### Columns storing S3 keys (paths)

| Table | Column |
|-------|--------|
| `dvyb_accounts` | `logoS3Key` |
| `dvyb_brand_ads` | `creativeImageS3Key`, `creativeVideoS3Key`, `extraImages` (jsonb) |
| `dvyb_assets` | `s3Key`, `thumbnailS3Key` |
| `dvyb_content_library` | `s3Key` |
| `dvyb_domain_product_images` | `s3Key` |
| `dvyb_account_products` | `imageS3Key` |
| `dvyb_image_regeneration` | `sourceImageS3Key`, `regeneratedImageS3Key` |
| `dvyb_image_edits` | `originalImageUrl`\*, `editedImageUrl`\*, `regeneratedImageUrl`\* |
| `dvyb_video_edits` | `originalVideoUrl`\*, `editedVideoUrl`\* |
| `dvyb_context` | `brandAssets` (jsonb) |

\* Misleading column names — these store S3 object keys, not full URLs.

### Columns storing full HTTPS URLs

| Table | Column |
|-------|--------|
| `dvyb_context` | `logoUrl`, `additionalLogoUrls` (jsonb), `brandImages` (jsonb), `documentUrls` (jsonb) |
| `dvyb_brand_ads` | `adSnapshotUrl`, `creativeImageUrl`, `creativeVideoUrl` |
| `dvyb_generated_content` | `userImages` (jsonb), `generatedImageUrls` (jsonb), `generatedVideoUrls` (jsonb) |
| `dvyb_content_library` | `thumbnailUrl` |
| `dvyb_inspiration_links` | `mediaUrl` |
