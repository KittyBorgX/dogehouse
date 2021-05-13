import { useRouter } from "next/router";
import React, { useContext, useEffect, useRef } from "react";
import { useCurrentRoomIdStore } from "../../global-stores/useCurrentRoomIdStore";
import { WebSocketContext } from "../ws/WebSocketProvider";
import { closeVoiceConnections } from "./closeVoiceConnections";
import { AudioRender } from "./components/AudioRender";
import { useMicIdStore } from "./stores/useMicIdStore";
import { useVoiceStore } from "./stores/useVoiceStore";
import { consumeAudio } from "./utils/consumeAudio";
import { createTransport } from "./utils/createTransport";
import { joinRoom } from "./utils/joinRoom";
import { receiveVoice } from "./utils/receiveVoice";
import { sendVoice } from "./utils/sendVoice";

interface App2Props {}

export const WebRtcApp: React.FC<App2Props> = () => {
  const { conn } = useContext(WebSocketContext);
  const { micId } = useMicIdStore();
  const { setCurrentRoomId } = useCurrentRoomIdStore();
  const initialLoad = useRef(true);
  const { push } = useRouter();

  useEffect(() => {
    if (micId && !initialLoad.current) {
      sendVoice();
    }
    initialLoad.current = false;
  }, [micId]);
  const consumerQueue = useRef<{ roomId: string; d: any }[]>([]);

  function flushConsumerQueue(_roomId: string) {
    try {
      for (const {
        roomId,
        d: { peerId, consumerParameters },
      } of consumerQueue.current) {
        if (_roomId === roomId) {
          consumeAudio(consumerParameters, peerId);
        }
      }
    } catch (err) {
      console.log(err);
    } finally {
      consumerQueue.current = [];
    }
  }

  useEffect(() => {
    if (!conn) {
      return;
    }

    const unsubs = [
      conn.addListener<any>("new-peer-speaker", async (d) => {
        const { roomId, recvTransport } = useVoiceStore.getState();
        if (recvTransport && roomId === d.roomId) {
          await consumeAudio(d.consumerParameters, d.peerId);
        } else {
          consumerQueue.current = [...consumerQueue.current, { roomId, d }];
        }
      }),
      conn.addListener<any>("you-are-now-a-speaker", async (d) => {
        if (d.roomId !== useVoiceStore.getState().roomId) {
          return;
        }
        // setStatus("connected-speaker");
        try {
          await createTransport(conn, d.roomId, "send", d.sendTransportOptions);
        } catch (err) {
          console.log(err);
          return;
        }
        console.log("sending voice");
        try {
          await sendVoice();
        } catch (err) {
          console.log(err);
        }
      }),
      conn.addListener<any>("you-joined-as-peer", async (d) => {
        closeVoiceConnections(null);
        useVoiceStore.getState().set({ roomId: d.roomId });
        // setStatus("connected-listener");
        consumerQueue.current = [];
        console.log("creating a device");
        try {
          await joinRoom(d.routerRtpCapabilities);
        } catch (err) {
          console.log("error creating a device | ", err);
          return;
        }
        try {
          await createTransport(conn, d.roomId, "recv", d.recvTransportOptions);
        } catch (err) {
          console.log("error creating recv transport | ", err);
          return;
        }
        receiveVoice(conn, () => flushConsumerQueue(d.roomId));
      }),
      conn.addListener<any>("you-joined-as-speaker", async (d) => {
        closeVoiceConnections(null);
        useVoiceStore.getState().set({ roomId: d.roomId });
        // setStatus("connected-speaker");
        consumerQueue.current = [];
        console.log("creating a device");
        try {
          await joinRoom(d.routerRtpCapabilities);
        } catch (err) {
          console.log("error creating a device | ", err);
          return;
        }
        try {
          await createTransport(conn, d.roomId, "send", d.sendTransportOptions);
        } catch (err) {
          console.log("error creating send transport | ", err);
          return;
        }
        console.log("sending voice");
        try {
          await sendVoice();
        } catch (err) {
          console.log("error sending voice | ", err);
          return;
        }
        await createTransport(conn, d.roomId, "recv", d.recvTransportOptions);
        receiveVoice(conn, () => flushConsumerQueue(d.roomId));
      }),
    ];

    return () => {
      unsubs.forEach((x) => x());
    };
  }, [conn, push, setCurrentRoomId]);

  return (
    <>
      <AudioRender />
    </>
  );
};
