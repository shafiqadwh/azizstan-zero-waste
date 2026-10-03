-- Rooms moved to the facilities system (2026-10-03): evaluation is per class, the class's building is chosen per
-- term, and the door QR is gone. Rewrites only the shipped wording of the default guide pages, so any text an
-- admin added or changed stays as it is.
UPDATE guide_pages SET body_md = replace(body_md, E'\n   หรือสแกน QR ที่หน้าห้องเพื่อเปิดแบบฟอร์มของห้องนั้นทันที', '');
--> statement-breakpoint
UPDATE guide_pages SET body_md = replace(
  body_md,
  '- ค้นหาด้วยเลขห้อง หรือ **สแกน QR ที่ประตูห้อง** ด้วยกล้องมือถือ ระบบจะเปิดแบบฟอร์มของห้องนั้นให้',
  '- ค้นหาด้วยชื่อห้องเรียน เช่น Amanah'
);
--> statement-breakpoint
UPDATE guide_pages SET body_md = replace(
  body_md,
  '1. ตรวจหัวแบบฟอร์มว่า **เลขห้อง · ชื่อห้อง · รอบ** ถูกต้อง',
  '1. ตรวจหัวแบบฟอร์มว่า **ห้องเรียน · รอบ** ถูกต้อง'
);
--> statement-breakpoint
UPDATE guide_pages SET body_md = replace(
  body_md,
  '2. **ตั้งค่า › สถานที่/ห้องเรียน** อาคาร โซน เลขห้อง และห้องเรียนที่อยู่ในแต่ละห้อง เลือกห้องเรียนที่ใช้ในภาคนี้',
  '2. **ตั้งค่า › ห้องเรียน** อาคาร โซน และห้องเรียน เลือกห้องเรียนที่ใช้ในภาคนี้ พร้อมอาคาร (หรือโซน) ของแต่ละห้องเรียน'
);
--> statement-breakpoint
UPDATE guide_pages SET body_md = replace(
  body_md,
  E'- **QR ประตูห้อง** ที่ ตั้งค่า › ห้องเรียน: "พิมพ์ QR ทุกห้อง" หรือรายอาคาร (ตั้ง APP_URL ของเซิร์ฟเวอร์ให้ถูกก่อนพิมพ์)\n',
  ''
);
