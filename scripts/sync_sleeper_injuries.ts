import { createClient } from "@supabase/supabase-js";
import { syncSleeperInjuries } from "../lib/injuries/sync";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Supabase server credentials are not configured.");
const result = await syncSleeperInjuries(createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } }));
console.log(JSON.stringify(result, null, 2));
