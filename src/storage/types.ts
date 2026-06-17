export interface Owner {
  telegram_id: number;
  name: string;
  created_at: string;
}

export interface Settings {
  open_time: string;
  close_time: string;
  timezone: string;
  sitting_length: number;
  slot_increment: number;
  reminder_lead_time: number;
  created_at: string;
  updated_at: string;
}

export interface TableType {
  id: string;
  seat_count: number;
  quantity: number;
  label: string;
  created_at: string;
}

export type BookingStatus = "confirmed" | "cancelled" | "rescheduled" | "no_show";

export interface TableAllocation {
  table_type_id: string;
  count: number;
}

export interface Booking {
  id: string;
  ref_code: string;
  guest_telegram_id: number;
  guest_name: string | null;
  guest_phone: string | null;
  date: string;
  start_time: string;
  end_time: string;
  duration: number;
  party_size: number;
  allocated_tables: TableAllocation[];
  status: BookingStatus;
  created_at: string;
  updated_at: string;
}

export interface AllocationDetail {
  booking_id: string;
  table_types: TableAllocation[];
  created_at: string;
}
