import Image from "next/image";

export function HenarBrand() {
  return (
    <>
      <Image className="henar-mark" src="/brand/henar.png" width={34} height={34} alt="" />
      <span className="henar-wordmark">Henar</span>
    </>
  );
}
