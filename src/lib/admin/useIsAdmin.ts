import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  const checked = useRef(false);

  const check = useCallback(async () => {
    if (checked.current) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      checked.current = true;
      setIsAdmin(false);
      return;
    }
    const { data, error } = await supabase.rpc("is_admin");
    if (error) {
      setIsAdmin(false);
    } else {
      setIsAdmin(Boolean(data));
    }
    checked.current = true;
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event) => {
        if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
          checked.current = false;
          check();
        }
      },
    );
    return () => subscription.unsubscribe();
  }, [check]);

  return isAdmin;
}
