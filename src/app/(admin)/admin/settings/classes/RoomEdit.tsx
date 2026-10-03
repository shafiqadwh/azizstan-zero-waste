'use client';

import { useActionState, useState } from 'react';
import { editRoomAction, type ActionState } from './actions';
import { ActionMessage, buttonClass, inputClass, Labelled } from './ui';

interface Room {
  id: string;
  roomNumber: string;
  buildingId: string;
  floor: number | null;
  isActive: boolean;
}

/**
 * One form for every room (a form per tile would repeat the building list hundreds of times): pick a room, then
 * move it to another building, renumber it or switch it off. The QR token stays, so printed QR codes keep working.
 */
export function RoomEditForm({ rooms, buildings }: { rooms: Room[]; buildings: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(editRoomAction, null);
  const [roomId, setRoomId] = useState('');
  const room = rooms.find((r) => r.id === roomId);
  const buildingName = new Map(buildings.map((b) => [b.id, b.name]));
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <div className="min-w-[160px] flex-1">
        <Labelled label="ห้องที่จะแก้ไข" htmlFor="e-room">
          <select
            id="e-room"
            name="id"
            required
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className={inputClass}
          >
            <option value="">เลือกห้อง</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.roomNumber} · {buildingName.get(r.buildingId) ?? ''}
              </option>
            ))}
          </select>
        </Labelled>
      </div>
      {/* keyed by room so the fields reset to the chosen room's values */}
      <fieldset key={roomId} disabled={!room} className="contents">
        <div className="min-w-[140px] flex-1">
          <Labelled label="ย้ายไปอาคาร" htmlFor="e-building">
            <select id="e-building" name="buildingId" defaultValue={room?.buildingId} className={inputClass}>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
        <div className="w-[120px]">
          <Labelled label="เลขห้อง" htmlFor="e-number">
            <input id="e-number" name="roomNumber" required defaultValue={room?.roomNumber} className={inputClass} />
          </Labelled>
        </div>
        <div className="w-[90px]">
          <Labelled label="ชั้นของห้อง" htmlFor="e-floor">
            <input
              id="e-floor"
              name="floor"
              type="number"
              min={0}
              max={20}
              defaultValue={room?.floor ?? ''}
              className={inputClass}
            />
          </Labelled>
        </div>
        <label className="flex h-11 items-center gap-2 text-[14px]">
          <input type="checkbox" name="isActive" defaultChecked={room?.isActive ?? true} /> ใช้งาน
        </label>
        <button type="submit" disabled={pending || !room} className={buttonClass}>
          บันทึกการแก้ไข
        </button>
      </fieldset>
      <div className="w-full">
        <ActionMessage state={state} />
      </div>
    </form>
  );
}
