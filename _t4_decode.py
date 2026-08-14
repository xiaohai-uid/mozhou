import base64, sys, os
src = "/mnt/c/zcode/novel-ai/_t4_content.b64"
dst = "/mnt/c/zcode/novel-ai/app/components/features/rankings-view.tsx"
with open(src, "r", encoding="utf-8") as f:
    b64 = "".join(f.read().split())
raw = base64.b64decode(b64)
data = raw.decode("utf-8").replace("\r\n", "\n")
with open(dst, "w", encoding="utf-8", newline="") as f:
    f.write(data)
print("WROTE", len(data), "bytes to", dst)
