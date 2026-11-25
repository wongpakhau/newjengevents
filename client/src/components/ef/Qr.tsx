import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function QrImage({ value, size = 220 }: { value: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size * 2, errorCorrectionLevel: "M", color: { dark: "#2b2118", light: "#ffffff" } }).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [value, size]);
  return src ? (
    <img src={src} alt="個人 QR code" width={size} height={size} className="rounded-lg bg-white p-2" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded-lg bg-muted animate-pulse" />
  );
}

/** 相機掃碼；掃到後只回呼一次。相機不可用時顯示說明，仍可改用手動輸入。 */
export function Scanner({ onResult }: { onResult: (text: string) => void }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (!on) return;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    done.current = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        const reader = new BrowserQRCodeReader();
        controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video.current!, (result) => {
          if (result && !done.current) {
            done.current = true;
            navigator.vibrate?.(60);
            setOn(false);
            onResult(result.getText());
          }
        });
        if (cancelled) controls.stop();
      } catch (e: any) {
        setErr(
          e?.name === "NotAllowedError"
            ? "未能使用相機：請在瀏覽器允許相機權限；若在內嵌預覽中被封鎖，請在手機瀏覽器直接開啟網址。也可改用下方「輸入會員碼」。"
            : "未能啟動相機，請改用下方「輸入會員碼」。"
        );
        setOn(false);
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      {on ? (
        <div className="relative overflow-hidden rounded-xl bg-black aspect-square">
          <video ref={video} className="h-full w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-gold/90" />
        </div>
      ) : null}
      <Button type="button" variant={on ? "outline" : "default"} className="w-full h-12 text-base" onClick={() => { setErr(null); setOn((v) => !v); }}>
        {on ? <><CameraOff className="mr-2" size={18} />停止掃描</> : <><Camera className="mr-2" size={18} />掃描會員 QR code</>}
      </Button>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </div>
  );
}
