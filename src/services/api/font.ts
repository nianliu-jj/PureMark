import { invoke } from "@/composables/useTauri";

export async function getSystemFonts(): Promise<string[]> {
  return invoke<string[]>("get_system_fonts");
}
