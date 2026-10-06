import { Composition, registerRoot } from "remotion";
import { SocialAd } from "./ad/SocialAd";
import { ShortAd } from "./ad/ShortAd";
import { GrinderAd } from "./ad/GrinderAd";
import { SalesDemo } from "./demo/SalesDemo";

function RemotionRoot() {
  return (
    <>
      {/* 15-second vertical ad — Electric Grinder product ad */}
      <Composition
        id="GrinderAd"
        component={GrinderAd}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />

      {/* 15-second vertical ad — 1080×1920 @ 9:16 for Stories/Reels/TikTok */}
      <Composition
        id="ShortAd"
        component={ShortAd}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />

      {/* ~40-second vertical ad — 1080×1920 @ 9:16 for Reels/TikTok/Shorts */}
      <Composition
        id="SocialAd"
        component={SocialAd}
        durationInFrames={1215}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />

      {/* ~3-min sales demo — 1920×1080 @ 16:9 */}
      <Composition
        id="SalesDemo"
        component={SalesDemo}
        durationInFrames={5400}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{}}
      />
    </>
  );
}

registerRoot(RemotionRoot);
