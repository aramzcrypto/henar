import Image from "next/image";
export function KaniBrand() {
  return (
    <>
      <Image
        className="kani-mark"
        src="/brand/kani-mark.svg"
        width={28}
        height={28}
        alt=""
        unoptimized
      />
      <span className="kani-wordmark">
        Kani <span>Markets</span>
      </span>
    </>
  );
}
