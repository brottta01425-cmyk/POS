import{createClient}from'@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_ANON_KEY;
if(!url||!key) console.warn('Missing Supabase environment variables. Copy .env.example to .env and add your values.');
export const supabase=createClient(url,key);
