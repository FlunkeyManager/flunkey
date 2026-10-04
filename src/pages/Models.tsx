import { useState, useEffect, useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { useStore } from "../store";
import { saveSettings } from "../persistence";
import { OpenRouterModelPicker } from "../components/OpenRouterPicker";
import {
  fetchOpenRouterCatalog,
  isCatalogStale,
  loadCatalogCache,
  saveCatalogCache,
  validateOpenRouterKey,
  type OpenRouterCatalogModel,
} from "../openrouter";
import {
  OPENAI_MODELS,
  GEMINI_MODELS,
  OPENAI_TRANSCRIPTION_MODELS,
  OPENROUTER_MODELS,
  GROQ_CHAT_MODEL,
  GROQ_POLISH_MODEL,
  GROQ_TRANSCRIBE_MODEL,
  GEMINI_TRANSCRIBE_MODEL,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TRANSCRIPTION_MODEL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  getGeminiTranscription,
  hasProviderKey,
} from "../types";
import type { AiProvider, SttProvider, UserSettings } from "../types";
import { fetchGroqModels, type GroqChatModel } from "../groqModels";
import { GroqModelPicker } from "../components/GroqModelPicker";
import { OllamaModelPicker } from "../components/OllamaModelPicker";
import { LocalModelCard } from "../components/LocalModelCard";
import {
  fetchOllamaModels,
  startOllamaServer,
  stopOllamaServer,
  waitForOllama,
  type OllamaModel,
} from "../ollama";
import { RECOMMENDED_LOCAL_MODEL } from "../whisper";
import { DEFAULT_OLLAMA_BASE_URL } from "../types";

export function GroqLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="18" viewBox="0 0 894.2 304.8" aria-hidden="true">
      <g><path fill="#fff" d="M499.3.5c-57.6 0-104.4 46.7-104.4 104.4s46.7 104.4 104.4 104.4 104.4-46.7 104.4-104.4C603.6 47.3 556.9.6 499.3.5zm0 169.6c-36 0-65.2-29.2-65.2-65.2s29.2-65.2 65.2-65.2 65.2 29.2 65.2 65.2-29.2 65.2-65.2 65.2zM355.2.9c-3.6-.4-7.1-.6-10.7-.6-1.8 0-3.5 0-5.2.1s-3.5.2-5.2.3c-7 .5-14 1.7-20.8 3.6-13.9 3.7-27 10.3-38.3 19.2-11.6 9.2-20.8 21-27.1 34.4-3.1 6.7-5.4 13.8-6.9 21-.7 3.6-1.2 7.2-1.6 10.8-.1 1.8-.3 3.6-.3 5.4l-.1 2.7v2.5l.1 35 .1 34.9.2 34.9h39.1l.2-34.9.1-34.9.1-35v-3.7c0-1.1.2-2.2.2-3.3.2-2.2.6-4.3 1-6.5.9-4.2 2.2-8.3 4-12.2 3.6-7.8 9-14.6 15.7-20 7-5.6 15.1-9.7 23.7-12 4.4-1.2 9-2 13.6-2.4 1.2-.1 2.3-.2 3.5-.2s2.4-.1 3.5-.1c2.2 0 4.5.1 6.7.3 8.9.9 17.5 3.6 25.4 8l19.5-33.9C383.3 7.1 369.5 2.5 355.2.9zM105.3 0C47.7-.5.5 45.8 0 103.4s45.8 104.8 103.4 105.3h36.2v-39.1h-34.3c-36 .4-65.6-28.4-66-64.5s28.4-65.6 64.5-66h1.5c36 0 65.2 29.2 65.4 65.2v96.1c0 35.7-29.1 64.8-64.7 65.2-17.1-.1-33.4-7-45.4-19.1l-27.7 27.7c19.2 19.3 45.2 30.3 72.4 30.5h1.4c56.9-.8 102.6-47 102.9-103.9v-99.1C208.2 45.2 161.9.1 105.3 0zM729.7.5c-57.6 0-104.4 46.7-104.3 104.4 0 57.6 46.7 104.3 104.3 104.3h35.7v-39.1h-35.7c-36 0-65.2-29.2-65.2-65.2s29.2-65.2 65.2-65.2c33.8 0 62 25.9 65 59.6h-.1v200.4h39.1V104.9C833.7 47.3 787.2.5 729.7.5z" /><path fill="#fff" d="M894.2 15.2c0 8.6-6.7 15.3-15.3 15.3-8.6 0-15.2-6.7-15.2-15.2S870.4 0 879 0c8.7 0 15.2 6.6 15.2 15.2zm-1.6 0c0-7.7-5.8-13.6-13.6-13.6s-13.7 6-13.7 13.6 5.9 13.6 13.6 13.6c7.8.1 13.7-6 13.7-13.6zm-9.8 2.5 4.1 6.2h-2.3l-3.8-5.8h-5.5V24H873V6.5h6.7c4.3 0 6.9 2.2 6.9 5.8.1 2.7-1.4 4.6-3.8 5.4zm1.7-5.4c0-2.5-1.8-3.9-4.8-3.9h-4.4v7.9h4.4c3 0 4.8-1.5 4.8-4z" /></g>
    </svg>
  );
}
export function OpenAiLogo() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 256 260" aria-hidden="true"><path fill="#fff" d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" /></svg>
  );
}
export function GeminiLogo() {
  return (
    <svg viewBox="0 0 296 298" xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" aria-hidden="true"><mask id="flunkey-gemini-mask" width="296" height="298" x="0" y="0" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }}><path fill="#3186FF" d="M141.201 4.886c2.282-6.17 11.042-6.071 13.184.148l5.985 17.37a184.004 184.004 0 0 0 111.257 113.049l19.304 6.997c6.143 2.227 6.156 10.91.02 13.155l-19.35 7.082a184.001 184.001 0 0 0-109.495 109.385l-7.573 20.629c-2.241 6.105-10.869 6.121-13.133.025l-7.908-21.296a184 184 0 0 0-109.02-108.658l-19.698-7.239c-6.102-2.243-6.118-10.867-.025-13.132l20.083-7.467A183.998 183.998 0 0 0 133.291 26.28l7.91-21.394Z" /></mask><g mask="url(#flunkey-gemini-mask)"><ellipse cx="163" cy="149" fill="#3689FF" rx="196" ry="159" /><ellipse cx="33.5" cy="142.5" fill="#F6C013" rx="68.5" ry="72.5" /><path fill="#FA4340" d="M194 10.5C172 82.5 65.5 134.333 22.5 135L144-66l50 76.5Z" /><path fill="#14BB69" d="M194.5 279.5C172.5 207.5 66 155.667 23 155l121.5 201 50-76.5Z" /></g></svg>
  );
}
export function OpenRouterLogo() {
  return (
    <svg width="22" height="22" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" fill="#ffff" stroke="#ffff" aria-hidden="true"><g clipPath="url(#flunkey-or-clip)"><path d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945" strokeWidth="90" fill="none"/><path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z"/><path d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377" strokeWidth="90" fill="none"/><path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z"/></g><defs><clipPath id="flunkey-or-clip"><rect width="512" height="512" fill="white"/></clipPath></defs></svg>
  );
}
export function OllamaLogo() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 646 854"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: "block" }}
    >
      <g>
        <path
          d="M140.629 0.239929C132.66 1.52725 123.097 5.69568 116.354 10.845C95.941 26.3541 80.1253 59.2728 73.4435 100.283C70.9302 115.792 69.2138 137.309 69.2138 153.738C69.2138 173.109 71.4819 197.874 74.7309 214.977C75.4665 218.778 75.8343 222.15 75.5278 222.395C75.2826 222.64 72.2788 225.092 68.9072 227.789C57.3827 236.984 44.2029 251.145 35.1304 264.08C17.7209 288.784 6.44151 316.86 1.72133 347.265C-0.117698 359.28 -0.608106 383.555 0.863118 395.57C4.11207 423.278 12.449 446.695 26.7321 468.151L31.391 475.078L30.0424 477.346C20.4794 493.407 12.3264 516.64 8.52575 538.953C5.522 556.608 5.15419 561.328 5.15419 584.99C5.15419 608.837 5.4607 613.557 8.28054 630.047C11.6521 649.786 18.5178 670.689 26.1804 684.605C28.6938 689.141 34.8239 698.581 35.5595 699.072C35.8047 699.194 35.0691 701.462 33.9044 704.098C25.077 723.408 17.537 749.093 14.4106 770.733C12.2038 785.567 11.8973 790.349 11.8973 805.981C11.8973 825.903 13.0007 835.589 17.1692 851.466L17.7822 853.795H44.019H70.3172L68.6007 850.546C57.9957 830.93 57.0149 794.517 66.1487 758.166C70.3172 741.369 75.0374 729.048 83.8647 712.067L89.1366 701.769V695.455C89.1366 689.57 89.014 688.896 87.1137 685.034C85.6424 682.091 83.6808 679.578 80.1866 676.145C74.2404 670.383 69.9494 664.314 66.5165 656.835C51.4365 624.1 48.494 575.489 59.0991 534.049C63.5128 516.762 70.8076 501.376 78.4702 492.978C83.6808 487.215 86.378 480.779 86.378 474.097C86.378 467.17 83.926 461.469 78.4089 455.523C62.5932 438.604 52.8464 418.006 49.3522 394.038C44.3868 359.893 53.3981 322.683 73.8726 293.198C93.9181 264.263 122.055 245.689 153.503 240.724C160.552 239.559 173.732 239.743 181.088 241.092C189.119 242.502 194.145 242.072 199.295 239.62C205.67 236.617 208.858 232.877 212.597 224.295C215.907 216.633 218.482 212.464 225.409 203.821C233.746 193.461 241.776 186.411 254.649 177.89C269.362 168.266 286.097 161.278 302.771 157.906C308.839 156.68 311.659 156.496 323 156.496C334.341 156.496 337.161 156.68 343.229 157.906C367.688 162.872 391.964 175.5 411.335 193.399C415.503 197.261 425.495 209.644 428.683 214.794C429.909 216.816 432.055 221.108 433.403 224.295C437.142 232.877 440.33 236.617 446.705 239.62C451.671 242.011 456.881 242.502 464.605 241.214C476.804 239.13 486.183 239.314 498.137 241.766C538.841 249.98 574.273 283.512 589.966 328.446C603.636 367.862 599.774 409.118 579.422 440.626C575.989 445.96 572.556 450.251 567.591 455.523C556.863 466.986 556.863 481.208 567.53 492.978C585.062 512.165 596.035 559.367 592.724 600.99C590.518 628.453 583.468 653.035 573.782 666.95C572.066 669.402 568.511 673.57 565.813 676.145C562.319 679.578 560.358 682.091 558.886 685.034C556.986 688.896 556.863 689.57 556.863 695.455V701.769L562.135 712.067C570.963 729.048 575.683 741.369 579.851 758.166C588.863 794.027 588.066 829.704 577.767 849.995C576.909 851.711 576.173 853.305 576.173 853.489C576.173 853.673 587.882 853.795 602.226 853.795H628.218L628.892 851.159C629.26 849.75 629.873 847.604 630.179 846.378C630.854 843.681 632.202 835.712 633.306 828.049C634.348 820.325 634.348 791.881 633.306 783.299C629.383 752.158 622.823 727.454 612.096 704.098C610.931 701.462 610.195 699.194 610.44 699.072C610.747 698.888 612.463 696.436 614.302 693.677C627.666 673.448 635.88 648.008 640.049 614.415C641.152 605.158 641.152 565.374 640.049 556.485C637.106 533.559 633.551 517.988 627.666 502.234C625.214 495.675 618.716 481.821 615.958 477.346L614.609 475.078L619.268 468.151C633.551 446.695 641.888 423.278 645.137 395.57C646.608 383.555 646.118 359.28 644.279 347.265C639.497 316.798 628.279 288.845 610.87 264.08C601.797 251.145 588.617 236.984 577.093 227.789C573.721 225.092 570.717 222.64 570.472 222.395C570.166 222.15 570.534 218.778 571.269 214.977C578.687 176.296 578.441 128.053 570.656 90.3524C563.913 57.4951 551.653 31.3808 535.837 16.3008C523.209 4.28578 510.336 -0.863507 494.888 0.11731C459.456 2.20154 430.89 42.9667 419.61 107.21C417.771 117.57 416.178 129.708 416.178 133.018C416.178 134.305 415.932 135.347 415.626 135.347C415.319 135.347 412.929 134.121 410.354 132.589C383.014 116.405 352.608 107.762 323 107.762C293.392 107.762 262.986 116.405 235.646 132.589C233.071 134.121 230.681 135.347 230.374 135.347C230.068 135.347 229.822 134.305 229.822 133.018C229.822 129.585 228.167 117.08 226.39 107.21C216.152 49.5259 192.674 11.3354 161.472 1.71112C157.181 0.423799 144.982 -0.434382 140.629 0.239929ZM151.051 50.139C159.878 57.1273 169.686 77.1114 175.326 99.4863C176.368 103.532 177.471 108.191 177.778 109.907C178.023 111.563 178.697 115.302 179.249 118.183C181.64 131.179 182.743 145.217 182.866 162.32L182.927 179.178L178.697 185.43L174.468 191.744H164.598C153.074 191.744 141.61 193.216 130.637 196.158C126.714 197.139 122.913 198.12 122.178 198.304C121.013 198.549 120.829 198.181 120.155 193.154C116.538 165.875 116.722 135.654 120.707 110.52C125.12 82.5059 135.419 57.1273 145.472 49.6486C147.863 47.8708 148.292 47.9321 151.051 50.139ZM500.589 49.7098C506.658 54.1848 513.34 66.0772 518.305 81.2798C528.297 111.685 531.117 153.431 525.845 193.154C525.171 198.181 524.987 198.549 523.822 198.304C523.087 198.12 519.286 197.139 515.363 196.158C504.39 193.216 492.926 191.744 481.402 191.744H471.532L467.303 185.43L463.073 179.178L463.134 162.32C463.257 138.535 465.464 119.961 470.735 99.3024C476.314 77.1114 486.183 57.1273 494.949 50.139C497.708 47.9321 498.137 47.8708 500.589 49.7098Z"
          fill="#fff"
        />
        <path
          d="M313.498 358.237C300.195 359.525 296.579 360.015 290.203 361.303C279.843 363.448 265.989 368.23 256.365 372.95C222.895 389.317 199.846 416.596 192.796 448.166C191.386 454.419 191.202 456.503 191.202 467.047C191.202 477.468 191.386 479.736 192.735 485.682C202.114 526.938 240.12 557.405 289.284 562.983C299.95 564.148 346.049 564.148 356.715 562.983C396.193 558.508 430.154 537.114 445.418 507.076C449.463 499.046 451.425 493.835 453.264 485.682C454.613 479.736 454.797 477.468 454.797 467.047C454.797 456.503 454.613 454.419 453.203 448.166C442.965 402.313 398.461 366.207 343.903 359.341C336.792 358.483 318.157 357.747 313.498 358.237ZM336.424 391.585C354.631 393.547 372.96 400.045 387.672 409.853C395.58 415.125 406.737 426.159 411.518 433.393C417.403 442.342 420.774 451.476 422.307 462.572C422.981 467.66 422.614 471.522 420.774 479.736C417.893 491.996 408.943 504.808 396.867 513.758C391.227 517.865 379.519 523.812 372.347 526.141C358.738 530.493 349.849 531.29 318.095 531.045C297.376 530.861 293.697 530.677 287.751 529.574C267.461 525.773 251.4 517.681 239.753 505.36C230.312 495.429 226.021 486.357 223.692 471.706C222.65 464.901 224.611 453.622 228.596 444.12C233.439 432.534 245.944 418.129 258.327 409.853C272.671 400.29 291.552 393.486 308.9 391.647C315.582 390.911 329.742 390.911 336.424 391.585Z"
          fill="#fff"
        />
        <path
          d="M299.584 436.336C294.925 438.849 291.676 445.224 292.657 449.944C293.76 455.032 298.235 460.182 305.223 464.412C308.963 466.68 309.208 466.986 309.392 469.254C309.514 470.603 309.024 474.465 308.35 477.898C307.614 481.269 307.062 484.825 307.062 485.806C307.124 488.442 309.576 492.733 312.15 494.817C314.419 496.656 314.848 496.717 321.223 496.901C327.047 497.085 328.273 496.962 330.602 495.859C336.61 492.916 338.142 487.522 335.935 477.162C334.096 468.519 334.464 467.17 339.062 464.534C343.904 461.714 349.054 456.749 350.586 453.377C353.529 446.941 350.831 439.646 344.333 436.274C342.74 435.477 340.778 435.11 337.897 435.11C333.422 435.11 330.541 436.152 325.269 439.523L322.265 441.424L320.365 440.259C312.58 435.661 311.17 435.11 306.449 435.171C303.078 435.171 301.239 435.477 299.584 436.336Z"
          fill="#fff"
        />
        <path
          d="M150.744 365.165C139.894 368.598 131.802 376.567 127.634 387.908C125.611 393.303 124.63 401.824 125.488 406.421C127.511 417.394 136.522 427.386 146.76 430.145C159.633 433.516 169.257 431.309 177.778 422.85C182.743 418.007 185.441 413.777 188.138 406.911C190.099 402.069 190.222 401.211 190.222 394.345L190.283 386.989L187.709 381.717C183.601 373.38 176.184 367.188 167.602 364.92C162.759 363.694 154.974 363.756 150.744 365.165Z"
          fill="#fff"
        />
        <path
          d="M478.153 364.982C469.755 367.25 462.276 373.502 458.291 381.717L455.717 386.989L455.778 394.345C455.778 401.211 455.901 402.069 457.862 406.911C460.56 413.777 463.257 418.007 468.222 422.85C476.743 431.309 486.367 433.516 499.241 430.145C506.658 428.183 514.075 421.93 517.631 414.635C520.696 408.444 521.431 403.969 520.451 396.919C518.183 380.797 508.742 369.089 494.704 364.982C490.597 363.756 482.628 363.756 478.153 364.982Z"
          fill="#fff"
        />
      </g>
    </svg>
  );
}
function LocalSttMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" stroke="#fff" strokeWidth="1.6" />
      <path d="M5 11a7 7 0 0 0 14 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 18v3.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function EyeIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}><path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/></svg>); }
function EyeOffIcon() { return (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block" }}><path d="M2.5 12S6 5.8 12 5.8c2 0 3.7.7 5.2 1.7M21.5 12S18 18.2 12 18.2c-2 0-3.7-.7-5.2-1.7"/><path d="M4 4l16 16"/></svg>); }

function ApiKeyInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <input className="settings-input mono" type={visible ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ paddingRight: "40px", flex: 1 }} />
      <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide key" : "Show key"} title={visible ? "Hide" : "Show"} style={{ position: "absolute", right: "8px", background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", display: "flex", alignItems: "center", padding: "4px" }}>{visible ? <EyeOffIcon /> : <EyeIcon />}</button>
    </div>
  );
}

const PROVIDER_META: Record<AiProvider, { label: string; hint: string; placeholder: string; helpUrl: string }> = {
  groq: { label: "Groq", hint: "Whisper Turbo + GPT-OSS. Fast & free tier.", placeholder: "gsk_...", helpUrl: "https://console.groq.com/keys" },
  openai: { label: "ChatGPT", hint: "GPT-4o + Whisper family. One key for both.", placeholder: "sk-...", helpUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Gemini", hint: "Gemini native audio + chat. Single key.", placeholder: "AIza...", helpUrl: "https://aistudio.google.com/app/apikey" },
  openrouter: { label: "OpenRouter", hint: "Route to 400+ models via one key. Chat only (STT via others).", placeholder: "sk-or-...", helpUrl: "https://openrouter.ai/keys" },
  ollama: { label: "Ollama", hint: "Local models on your machine. No key, no data leaves the PC.", placeholder: "http://localhost:11434", helpUrl: "https://ollama.com/download" },
};

/** Small lowercase-i dot that reveals its description on hover. */
function InfoDot({ text }: { text: string }) {
  return (
    <span className="info-dot" title={text} aria-label={text}>
      i
    </span>
  );
}

export function Models() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  const [groqKey, setGroqKey] = useState(settings.groqApiKey);
  const [groqCatalog, setGroqCatalog] = useState<GroqChatModel[]>([]);
  const [groqCatalogLoading, setGroqCatalogLoading] = useState(false);
  const [groqCatalogError, setGroqCatalogError] = useState("");
  const [openaiKey, setOpenaiKey] = useState(settings.openaiApiKey ?? "");
  const [geminiKey, setGeminiKey] = useState(settings.geminiApiKey ?? "");
  const [openRouterKey, setOpenRouterKey] = useState(settings.openRouterApiKey ?? "");

  // Local models (Ollama) — no key, just an enabled flag + base URL.
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState(
    settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL
  );
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaError, setOllamaError] = useState("");
  const [ollamaStarting, setOllamaStarting] = useState(false);
  const [ollamaStopping, setOllamaStopping] = useState(false);

  // Per-task assignments
  const [sttProvider, setSttProvider] = useState<SttProvider>(settings.sttProvider ?? settings.aiProvider ?? "groq");
  const [sttModel, setSttModel] = useState(settings.sttModel ?? "");
  const [localSttModel, setLocalSttModel] = useState(
    settings.localSttModel || RECOMMENDED_LOCAL_MODEL
  );
  /** True once an on-device model is installed, so the chip stays enabled. */
  const [localSttInstalled, setLocalSttInstalled] = useState(false);
  const [f9Provider, setF9Provider] = useState<AiProvider>(settings.f9Provider ?? settings.aiProvider ?? "groq");
  const [f9Model, setF9Model] = useState(settings.f9Model ?? "");
  const [f10Provider, setF10Provider] = useState<AiProvider>(settings.f10Provider ?? settings.aiProvider ?? "groq");
  const [f10Model, setF10Model] = useState(settings.f10Model ?? "");
  const [polishProvider, setPolishProvider] = useState<AiProvider>(settings.polishProvider ?? settings.aiProvider ?? "groq");
  const [polishModel, setPolishModel] = useState(settings.polishModel ?? "");

  // Legacy per-provider chat models (kept for backward compat, still editable in assignments)
  const [openaiModel, setOpenaiModel] = useState(settings.openaiModel ?? "gpt-4o-mini");
  const [openaiTranscription, setOpenaiTranscription] = useState(settings.openaiTranscriptionModel ?? "gpt-4o-mini-transcribe");
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel ?? "gemini-2.5-flash");
  const [geminiTranscription, setGeminiTranscription] = useState(settings.geminiTranscriptionModel ?? "");
  // OpenRouter's default is fixed: its free-models router. There is no
  // selector for it — pick a specific model per task (F9 / F10 / Polish)
  // when you want one.

  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistDraftRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const skipAutoSave = useRef(true);

  // OpenRouter dynamic catalog (disk-cached, stale-while-revalidate).
  const [orCatalog, setOrCatalog] = useState<OpenRouterCatalogModel[] | null>(null);
  const [orCatalogUpdatedAt, setOrCatalogUpdatedAt] = useState<number | null>(null);
  const [orCatalogLoading, setOrCatalogLoading] = useState(false);
  const orRefreshing = useRef(false);
  // Per-provider Connect status (memory-only, set at Connect time).
  type ConnectState = { state: "idle" | "checking" | "ok" | "error"; message?: string };
  const [connectStatus, setConnectStatus] = useState<Record<AiProvider, ConnectState>>({
    groq: { state: "idle" },
    openai: { state: "idle" },
    gemini: { state: "idle" },
    openrouter: { state: "idle" },
    ollama: { state: "idle" },
  });

  const refreshOllamaModels = useCallback(async (baseUrl: string) => {
    setOllamaLoading(true);
    setOllamaError("");
    try {
      setOllamaModels(await fetchOllamaModels(baseUrl));
    } catch (error) {
      setOllamaModels([]);
      setOllamaError(
        error instanceof TypeError
          ? "Can't reach Ollama — is it running?"
          : error instanceof Error
            ? error.message
            : "Could not load local models."
      );
    } finally {
      setOllamaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings.ollamaEnabled) {
      void refreshOllamaModels(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
    }
  }, [settings.ollamaEnabled, settings.ollamaBaseUrl, refreshOllamaModels]);

  /** Launch the local server, wait for it, then connect like Connect does. */
  const startOllama = useCallback(
    async (baseUrl: string) => {
      setOllamaStarting(true);
      setConnectStatus((prev) => ({ ...prev, ollama: { state: "checking" } }));
      try {
        const result = await startOllamaServer();
        if (!result.ok) {
          setConnectStatus((prev) => ({
            ...prev,
            ollama: { state: "error", message: result.error ?? "Could not start" },
          }));
          return;
        }
        const models = await waitForOllama(baseUrl);
        if (!models) {
          setConnectStatus((prev) => ({
            ...prev,
            ollama: {
              state: "error",
              message: "Ollama started but didn't answer. Check the Models page in Ollama.",
            },
          }));
          return;
        }
        setOllamaModels(models);
        setOllamaError("");
        const updated = {
          ...useStore.getState().settings,
          ollamaEnabled: true,
          ollamaBaseUrl: baseUrl,
        };
        setSettings(updated);
        await saveSettings(updated);
        setConnectStatus((prev) => ({
          ...prev,
          ollama: { state: "ok", message: `Connected · ${models.length} models` },
        }));
      } finally {
        setOllamaStarting(false);
      }
    },
    [setSettings]
  );

  /** Stop the server and switch the provider back off. */
  const stopOllama = useCallback(
    async (baseUrl: string) => {
      setOllamaStopping(true);
      try {
        const result = await stopOllamaServer(baseUrl);
        if (!result.ok) {
          setConnectStatus((prev) => ({
            ...prev,
            ollama: { state: "error", message: result.error ?? "Could not stop" },
          }));
          return;
        }
        setOllamaModels([]);
        setOllamaError("");
        const updated = { ...useStore.getState().settings, ollamaEnabled: false };
        setSettings(updated);
        await saveSettings(updated);
        setConnectStatus((prev) => ({
          ...prev,
          ollama: {
            state: "idle",
            message: result.message ?? "Stopped — Ollama is off",
          },
        }));
      } finally {
        setOllamaStopping(false);
      }
    },
    [setSettings]
  );

  const refreshGroqCatalog = useCallback(async (apiKey: string) => {
    if (!apiKey.trim()) {
      setGroqCatalog([]);
      setGroqCatalogError("Add a Groq API key to load available models.");
      return;
    }
    setGroqCatalogLoading(true);
    setGroqCatalogError("");
    try {
      setGroqCatalog(await fetchGroqModels(apiKey));
    } catch (error) {
      setGroqCatalogError(
        error instanceof Error ? error.message : "Could not load Groq models."
      );
    } finally {
      setGroqCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    if (settings.groqApiKey.trim()) {
      void refreshGroqCatalog(settings.groqApiKey);
    } else {
      setGroqCatalog([]);
      setGroqCatalogError("");
    }
  }, [settings.groqApiKey, refreshGroqCatalog]);

  useEffect(() => {
    if (
      f9Provider === "groq" &&
      !f9Model.trim() &&
      groqCatalog.some((model) => model.id === DEFAULT_GROQ_MODEL)
    ) {
      setF9Model(DEFAULT_GROQ_MODEL);
    }
    if (f10Provider === "groq" && !f10Model.trim()) setF10Model(GROQ_CHAT_MODEL);
    if (polishProvider === "groq" && !polishModel.trim()) setPolishModel(GROQ_POLISH_MODEL);
    if (sttProvider === "groq" && !sttModel.trim()) setSttModel(GROQ_TRANSCRIBE_MODEL);
  }, [f9Provider, f9Model, f10Provider, f10Model, polishProvider, polishModel, sttProvider, sttModel, groqCatalog]);

  const refreshOrCatalog = useCallback(async () => {
    if (orRefreshing.current) return;
    orRefreshing.current = true;
    setOrCatalogLoading(true);
    try {
      const models = await fetchOpenRouterCatalog();
      const updatedAt = Date.now();
      setOrCatalog(models);
      setOrCatalogUpdatedAt(updatedAt);
      await saveCatalogCache({ updatedAt, models });
    } catch {
      // Keep stale cache / offline fallback — picker explains itself.
    } finally {
      setOrCatalogLoading(false);
      orRefreshing.current = false;
    }
  }, []);

  // Load cache instantly; refresh in background only when missing or stale.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await loadCatalogCache();
      if (cancelled) return;
      if (cached) {
        setOrCatalog(cached.models);
        setOrCatalogUpdatedAt(cached.updatedAt);
        if (
          isCatalogStale(cached.updatedAt) ||
          cached.models.some((model) => !Array.isArray(model.inputModalities))
        ) {
          void refreshOrCatalog();
        }
      } else {
        void refreshOrCatalog();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshOrCatalog]);

  const connectProvider = useCallback(async (provider: AiProvider) => {
    // Ollama isn't in here on purpose: its single control is Start/Stop,
    // which launches the server and connects in one step.
    const draftRaw =
      provider === "groq" ? groqKey : provider === "openai" ? openaiKey : provider === "gemini" ? geminiKey : openRouterKey;
    const draft = draftRaw.trim();
    const keyField =
      provider === "groq" ? "groqApiKey" : provider === "openai" ? "openaiApiKey" : provider === "gemini" ? "geminiApiKey" : "openRouterApiKey";
    // Empty draft + Connect = disconnect (remove saved key).
    if (!draft) {
      const updated = { ...useStore.getState().settings, [keyField]: "" };
      setSettings(updated);
      await saveSettings(updated);
      setConnectStatus((prev) => ({ ...prev, [provider]: { state: "idle" } }));
      return;
    }
    setConnectStatus((prev) => ({ ...prev, [provider]: { state: "checking" } }));
    try {
      if (provider === "groq") {
        const models = await fetchGroqModels(draft);
        setGroqCatalog(models);
        setGroqCatalogError("");
      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${draft}` },
        });
        if (!res.ok) {
          setConnectStatus((prev) => ({
            ...prev,
            [provider]: { state: "error", message: res.status === 401 ? "Invalid key (401)" : `Invalid key (${res.status})` },
          }));
          return;
        }
      } else if (provider === "gemini") {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
          headers: { "x-goog-api-key": draft },
        });
        if (!res.ok) {
          setConnectStatus((prev) => ({ ...prev, [provider]: { state: "error", message: `Invalid key (${res.status})` } }));
          return;
        }
      } else {
        const result = await validateOpenRouterKey(draft);
        if (!result.ok) {
          setConnectStatus((prev) => ({ ...prev, [provider]: { state: "error", message: result.error ?? "Invalid key" } }));
          return;
        }
      }
      const updated = { ...useStore.getState().settings, [keyField]: draft };
      setSettings(updated);
      await saveSettings(updated);
      setConnectStatus((prev) => ({ ...prev, [provider]: { state: "ok", message: "Connected" } }));
    } catch {
      setConnectStatus((prev) => ({ ...prev, [provider]: { state: "error", message: "Network error" } }));
    }
  }, [groqKey, openaiKey, geminiKey, openRouterKey, ollamaBaseUrl, setSettings]);

  useEffect(() => {
    setGroqKey(settings.groqApiKey);
    setOpenaiKey(settings.openaiApiKey ?? "");
    setGeminiKey(settings.geminiApiKey ?? "");
    setOpenRouterKey(settings.openRouterApiKey ?? "");
    setSttProvider(settings.sttProvider ?? settings.aiProvider ?? "groq");
    setSttModel(settings.sttModel ?? "");
    setLocalSttModel(settings.localSttModel || RECOMMENDED_LOCAL_MODEL);
    setF9Provider(settings.f9Provider ?? settings.aiProvider ?? "groq");
    setF9Model(settings.f9Model ?? "");
    setF10Provider(settings.f10Provider ?? settings.aiProvider ?? "groq");
    setF10Model(settings.f10Model ?? "");
    setPolishProvider(settings.polishProvider ?? settings.aiProvider ?? "groq");
    setPolishModel(settings.polishModel ?? "");
    setOpenaiModel(settings.openaiModel ?? "gpt-4o-mini");
    setOpenaiTranscription(settings.openaiTranscriptionModel ?? "gpt-4o-mini-transcribe");
    setGeminiModel(settings.geminiModel ?? "gemini-2.5-flash");
    setGeminiTranscription(settings.geminiTranscriptionModel ?? "");
    setOllamaBaseUrl(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
    skipAutoSave.current = true;
  }, [settings]);

  const buildDraft = useCallback((): UserSettings => {
    const base = useStore.getState().settings;
    return {
      ...base,
      sttProvider, sttModel: sttModel.trim(),
      localSttModel: localSttModel || RECOMMENDED_LOCAL_MODEL,
      f9Provider, f9Model: f9Model.trim(),
      f10Provider, f10Model: f10Model.trim(),
      polishProvider, polishModel: polishModel.trim(),
      openaiModel: openaiModel.trim() || "gpt-4o-mini",
      openaiTranscriptionModel: openaiTranscription.trim() || "gpt-4o-mini-transcribe",
      geminiModel: geminiModel.trim() || "gemini-2.5-flash",
      geminiTranscriptionModel: geminiTranscription.trim(),
      openRouterModel: DEFAULT_OPENROUTER_MODEL,
      ollamaBaseUrl: ollamaBaseUrl.trim() || DEFAULT_OLLAMA_BASE_URL,
      // keep legacy aiProvider in sync with last STT choice for backward compat
      aiProvider: sttProvider === "local" ? (base.aiProvider ?? "groq") : sttProvider,
    };
  }, [sttProvider, sttModel, f9Provider, f9Model, f10Provider, f10Model, polishProvider, polishModel, openaiModel, openaiTranscription, geminiModel, geminiTranscription, ollamaBaseUrl, localSttModel]);

  const persistDraft = useCallback(async () => {
    const updated = buildDraft();
    const current = useStore.getState().settings;
    if (
      updated.groqApiKey === current.groqApiKey &&
      updated.openaiApiKey === current.openaiApiKey &&
      updated.geminiApiKey === current.geminiApiKey &&
      updated.openRouterApiKey === current.openRouterApiKey &&
      updated.sttProvider === current.sttProvider &&
      updated.sttModel === current.sttModel &&
      updated.localSttModel === (current.localSttModel ?? "") &&
      updated.f9Provider === current.f9Provider &&
      updated.f9Model === current.f9Model &&
      updated.f10Provider === current.f10Provider &&
      updated.f10Model === current.f10Model &&
      updated.polishProvider === current.polishProvider &&
      updated.polishModel === current.polishModel &&
      updated.openaiModel === current.openaiModel &&
      updated.openaiTranscriptionModel === current.openaiTranscriptionModel &&
      updated.geminiModel === current.geminiModel &&
      updated.geminiTranscriptionModel === current.geminiTranscriptionModel &&
      updated.openRouterModel === current.openRouterModel &&
      updated.ollamaBaseUrl === current.ollamaBaseUrl
    ) return;
    setSettings(updated);
    await saveSettings(updated);
    setSavedFlash(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 1500);
  }, [buildDraft, setSettings]);

  useEffect(() => {
    persistDraftRef.current = persistDraft;
  }, [persistDraft]);

  useEffect(() => {
    if (skipAutoSave.current) { skipAutoSave.current = false; return; }
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistDraft(), 450);
    return () => clearTimeout(saveTimer.current);
  }, [sttProvider, sttModel, f9Provider, f9Model, f10Provider, f10Model, polishProvider, polishModel, openaiModel, openaiTranscription, geminiModel, geminiTranscription, ollamaBaseUrl, localSttModel, persistDraft]);

  useEffect(() => () => {
    clearTimeout(saveTimer.current);
    clearTimeout(flashTimer.current);
    // Page navigation unmounts this view. Flush the latest draft instead of
    // discarding a still-debounced API key or model assignment.
    void persistDraftRef.current();
  }, []);

  const hasKey = (p: AiProvider) => hasProviderKey(settings, p);

  /* ── Provider switches must never leave a foreign model id behind ──────
   * Each task row keeps one model string, so without this a Groq id
   * ("qwen/…") would still sit in the OpenRouter picker after switching.
   * Every task remembers its model per provider: switching away stashes the
   * current value, switching back restores it, and a provider never seen
   * before starts from that provider's own default. */
  type TaskId = "stt" | "f9" | "f10" | "polish";
  const modelMemory = useRef<Record<string, Partial<Record<SttProvider, string>>>>(
    {}
  );

  const defaultModelFor = (task: TaskId, provider: AiProvider): string => {
    const s = useStore.getState().settings;
    if (provider === "groq") {
      if (task === "stt") return GROQ_TRANSCRIBE_MODEL;
      if (task === "polish") return GROQ_POLISH_MODEL;
      return GROQ_CHAT_MODEL;
    }
    if (provider === "openai") {
      if (task === "stt") {
        return s.openaiTranscriptionModel?.trim() || DEFAULT_OPENAI_TRANSCRIPTION_MODEL;
      }
      return s.openaiModel?.trim() || DEFAULT_OPENAI_MODEL;
    }
    if (provider === "gemini") {
      if (task === "stt") return getGeminiTranscription(s).model;
      return s.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;
    }
    if (provider === "openrouter") {
      return s.openRouterModel?.trim() || DEFAULT_OPENROUTER_MODEL;
    }
    // Local models: no server-side default, so start empty and let the
    // picker show its "Select model…" state.
    return s.ollamaModel?.trim() || "";
  };

  /** Returns the [provider, model] pair a task row should adopt. */
  const nextProviderFor = (
    task: TaskId,
    current: SttProvider,
    currentModel: string,
    next: SttProvider
  ): { provider: SttProvider; model: string } => {
    if (next === current) return { provider: current, model: currentModel };
    const memory = (modelMemory.current[task] ??= {});
    if (current) memory[current] = currentModel;
    // On-device has one model of its own, managed by the download card.
    if (next === "local") {
      return { provider: next, model: localSttModel || RECOMMENDED_LOCAL_MODEL };
    }
    const remembered = memory[next];
    return {
      provider: next,
      model: remembered !== undefined ? remembered : defaultModelFor(task, next),
    };
  };

  const switchSttProvider = useCallback(
    (next: SttProvider) => {
      const { provider, model } = nextProviderFor("stt", sttProvider, sttModel, next);
      setSttProvider(provider);
      setSttModel(model);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sttProvider, sttModel]
  );
  const switchF9Provider = useCallback(
    (next: SttProvider) => {
      const { provider, model } = nextProviderFor("f9", f9Provider, f9Model, next);
      setF9Provider(provider as AiProvider);
      setF9Model(model);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f9Provider, f9Model]
  );
  const switchF10Provider = useCallback(
    (next: SttProvider) => {
      const { provider, model } = nextProviderFor("f10", f10Provider, f10Model, next);
      setF10Provider(provider as AiProvider);
      setF10Model(model);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f10Provider, f10Model]
  );
  const switchPolishProvider = useCallback(
    (next: SttProvider) => {
      const { provider, model } = nextProviderFor(
        "polish",
        polishProvider,
        polishModel,
        next
      );
      setPolishProvider(provider as AiProvider);
      setPolishModel(model);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [polishProvider, polishModel]
  );

  const renderProviderCard = (provider: AiProvider) => {
    const meta = PROVIDER_META[provider];
    // Ollama has no key — a server URL is the equivalent field.
    if (provider === "ollama") {
      const ollamaStatus = connectStatus.ollama;
      const ollamaOn = hasKey("ollama");
      // "Up" means enabled AND answering. A server that died while enabled
      // falls back to Start, which relaunches and reconnects it.
      const ollamaUp = ollamaOn && !ollamaError;
      return (
        <div key={provider} className={`models-provider-card${ollamaUp ? " models-provider-card--connected" : ""}`}>
          <div className="models-provider-heading">
            <span className="provider-logo">
              <OllamaLogo />
            </span>
            <span className="usecase-label" title={meta.hint}>{meta.label}</span>
            <InfoDot text={`${meta.hint} Install from ${meta.helpUrl}`} />
            <span className={`models-provider-status${ollamaUp ? " connected" : ""}`} style={{ marginLeft: "auto" }}>{ollamaUp ? "●" : "○"}</span>
          </div>
          <div className="models-key-field">
            <input
              className="settings-input mono"
              type="text"
              value={ollamaBaseUrl}
              onChange={(e) => setOllamaBaseUrl(e.target.value)}
              placeholder={DEFAULT_OLLAMA_BASE_URL}
            />
            <div className="models-key-meta">
              {ollamaOn ? (
                <span className="models-key-note">{ollamaModels.length} local models</span>
              ) : (
                <a href={meta.helpUrl} target="_blank" rel="noreferrer" className="link models-key-link">Install Ollama ↗</a>
              )}
              {/* One control: Start before it's up, Stop once it is. */}
              {ollamaUp ? (
                <button
                  type="button"
                  className="models-mini-btn"
                  onClick={() => void stopOllama(ollamaBaseUrl)}
                  disabled={ollamaStopping}
                  title="Stop the local Ollama server and turn the provider off"
                >
                  {ollamaStopping ? "Stopping…" : "✕ Stop Ollama"}
                </button>
              ) : (
                <button
                  type="button"
                  className="models-mini-btn"
                  onClick={() => void startOllama(ollamaBaseUrl)}
                  disabled={ollamaStarting}
                  title="Launch the local Ollama server and wait for it to come up"
                >
                  {ollamaStarting ? "Starting…" : "▶ Start Ollama"}
                </button>
              )}
            </div>
            <div className="models-key-meta">
              {ollamaStatus.state === "ok" && <span className="models-key-note" style={{ color: "#22c55e" }}>{ollamaStatus.message ?? "Connected"}</span>}
              {ollamaStatus.state === "error" && <span className="models-key-note" style={{ color: "#ef4444" }}>{ollamaStatus.message ?? "Connection failed"}</span>}
              {ollamaOn && ollamaError && <span className="models-key-note" style={{ color: "#ef4444" }}>{ollamaError}</span>}
            </div>
          </div>
        </div>
      );
    }
    const value = provider === "groq" ? groqKey : provider === "openai" ? openaiKey : provider === "gemini" ? geminiKey : openRouterKey;
    const setter = provider === "groq" ? setGroqKey : provider === "openai" ? setOpenaiKey : provider === "gemini" ? setGeminiKey : setOpenRouterKey;
    const savedKey = provider === "groq" ? (settings.groqApiKey ?? "") : provider === "openai" ? (settings.openaiApiKey ?? "") : provider === "gemini" ? (settings.geminiApiKey ?? "") : (settings.openRouterApiKey ?? "");
    const modelsCount = provider === "groq" ? groqCatalog.length : provider === "openai" ? OPENAI_MODELS.length + OPENAI_TRANSCRIPTION_MODELS.length : provider === "gemini" ? GEMINI_MODELS.length + 1 : orCatalog ? orCatalog.length : OPENROUTER_MODELS.length;
    const has = hasKey(provider);
    const status = connectStatus[provider];
    const dirty = value.trim() !== (savedKey ?? "").trim();
    return (
      <div key={provider} className={`models-provider-card${has ? " models-provider-card--connected" : ""}`}>
        <div className="models-provider-heading">
          <span className="provider-logo">
            {provider === "groq" ? <GroqLogo /> : provider === "openai" ? <OpenAiLogo /> : provider === "gemini" ? <GeminiLogo /> : <OpenRouterLogo />}
          </span>
          <span className="usecase-label" title={meta.hint}>{meta.label}</span>
          <InfoDot text={`${meta.hint} Get a key at ${meta.helpUrl}`} />
          <span className={`models-provider-status${has ? " connected" : ""}`} style={{ marginLeft: "auto" }}>{has ? "●" : "○"}</span>
        </div>
        <div className="models-key-field">
          <ApiKeyInput value={value} onChange={setter} placeholder={meta.placeholder} />
          <div className="models-key-meta">
            {has ? (
              <span className="models-key-note">{modelsCount} models</span>
            ) : (
              <a href={meta.helpUrl} target="_blank" rel="noreferrer" className="link models-key-link">Get a key ↗</a>
            )}
            <button type="button" className="models-mini-btn" onClick={() => void connectProvider(provider)} disabled={status.state === "checking"}>
              {status.state === "checking" ? "…" : "Connect"}
            </button>
            {provider === "openrouter" && (
              <button type="button" className="models-mini-btn" onClick={() => void refreshOrCatalog()} disabled={orCatalogLoading} title="Refresh the model list">
                {orCatalogLoading ? "…" : "↻ Models"}
              </button>
            )}
            {provider === "groq" && has && (
              <button
                type="button"
                className="models-mini-btn"
                onClick={() => void refreshGroqCatalog(value)}
                disabled={groqCatalogLoading}
                title="Refresh the models available to this Groq key"
              >
                {groqCatalogLoading ? "…" : "↻ Models"}
              </button>
            )}
          </div>
          <div className="models-key-meta">
            {status.state === "checking" && <span className="models-key-note">Checking…</span>}
            {status.state === "ok" && <span className="models-key-note" style={{ color: "#22c55e" }}>Connected</span>}
            {status.state === "error" && <span className="models-key-note" style={{ color: "#ef4444" }}>{status.message ?? "Invalid key"}</span>}
            {provider === "groq" && groqCatalogError && <span className="models-key-note" style={{ color: "#ef4444" }}>{groqCatalogError}</span>}
            {dirty && <span className="models-key-note" style={{ opacity: 0.65 }}>(unsaved changes)</span>}
          </div>
        </div>
      </div>
    );
  };

  const taskRow = (
    label: string,
    desc: string,
    provider: SttProvider,
    onSelectProvider: (p: SttProvider) => void,
    model: string,
    setModel: (m: string) => void,
    supportedProviders: SttProvider[],
    modelOptions: { id: string; label: string }[],
    fixedNote?: string,
    openRouterPicker?: ReactNode,
    modelAction?: ReactNode
  ) => {
    const isFixed = provider === "groq" && fixedNote;
    const isLocal = provider === "local";
    // "local" is available as soon as a model exists; it never has a key.
    const providerReady = (p: SttProvider) =>
      p === "local" ? localSttInstalled : hasKey(p);
    const providerLabel = (p: SttProvider) =>
      p === "local" ? "On-device" : PROVIDER_META[p].label;
    return (
      <section className="models-task-card">
        <div className="models-task-heading">
          <span className="settings-label">{label}</span>
          <InfoDot text={desc} />
        </div>
        <div className="models-provider-options">
          {supportedProviders.map((p) => {
            const has = providerReady(p);
            const active = provider === p;
            return (
              <button
                key={p}
                type="button"
                className={`model-option${active ? " selected" : ""}`}
                disabled={!has && !active}
                onClick={() => has && onSelectProvider(p)}
                title={
                  has
                    ? providerLabel(p)
                    : p === "local"
                      ? "Download a speech model first (see On-device voice above)"
                      : `${providerLabel(p)} — add key first`
                }
                style={{ opacity: !has && !active ? 0.45 : 1 }}
              >
                <span className="models-provider-mark">{p === "groq" ? <GroqLogo /> : p === "openai" ? <OpenAiLogo /> : p === "gemini" ? <GeminiLogo /> : p === "ollama" ? <OllamaLogo /> : p === "local" ? <LocalSttMark /> : <OpenRouterLogo />}</span>
                {providerLabel(p)}
              </button>
            );
          })}
        </div>
        {isFixed ? (
          <div className="memory-stats-group models-fixed-note">
            <div className="stat-pill"><span className="stat-pill-num">{fixedNote}</span><span className="stat-pill-label">Fixed</span></div>
          </div>
        ) : isLocal ? (
          <div className="settings-desc" style={{ marginTop: 6 }}>
            Transcribing on this PC with the{" "}
            <strong>{localSttModel}</strong> model — no API key, no cost, works
            offline. Change or download a different size under{" "}
            <strong>On-device voice</strong> above.
          </div>
        ) : provider === "openrouter" && openRouterPicker ? (
          openRouterPicker
        ) : provider === "ollama" && modelAction ? (
          modelAction
        ) : (
          <>
            {modelAction}
            <div className="models-model-options">
              {modelOptions.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`model-option${model === m.id ? " selected" : ""}`}
                  onClick={() => setModel(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </>
        )}
        {!isLocal && !providerReady(provider) && <div className="settings-desc" style={{ color: "#f59e0b", marginTop: 6 }}>This assignment has no key. Flunkey will fall back to a connected provider until you add one.</div>}
      </section>
    );
  };

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="pageTitle">Models{savedFlash ? " · Saved" : ""}</div>
        </div>
      </div>

      <div className="settings-section">
        <div className="models-provider-grid">
          {(["groq", "openai", "gemini", "openrouter", "ollama"] as AiProvider[]).map(renderProviderCard)}
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label models-section-title">On-device voice (no API key)</div>
        <div className="settings-desc">
          Download a speech model once and Flunkey transcribes on this PC — no
          key, no cost, and it keeps working offline. Pick it under
          Voice-to-Text below.
        </div>
        <LocalModelCard
          selectedModel={localSttModel}
          onSelectModel={setLocalSttModel}
          onInstalledChange={setLocalSttInstalled}
        />
      </div>

      <div className="settings-section">
        <div className="settings-label models-section-title">Assignments</div>

      {taskRow("Voice-to-Text", "Transcribes your speech before any other step. On-device runs free on this PC; the cloud options are faster for long clips.", sttProvider, switchSttProvider, sttModel, setSttModel, ["local", "groq", "openai", "gemini"] as SttProvider[], sttProvider === "groq" ? [] : sttProvider === "openai" ? OPENAI_TRANSCRIPTION_MODELS.map((m) => ({ id: m.id, label: m.label })) : sttProvider === "gemini" ? [...GEMINI_MODELS.map((m) => ({ id: m.id, label: m.label })), { id: GEMINI_TRANSCRIBE_MODEL, label: "Gemini 3.5 Transcribe" }] : [], undefined, undefined, sttProvider === "groq" ? (
       <GroqModelPicker value={sttModel} onChange={setSttModel} catalog={groqCatalog} loading={groqCatalogLoading} error={groqCatalogError} onRefresh={() => void refreshGroqCatalog(groqKey)} filter={["stt"]} />
     ) : undefined)}

      {taskRow(
        "F9 — Ask AI",
        "Voice to AI: your question + conversation history. Choose a vision-capable model to attach screenshots.",
        f9Provider,
        switchF9Provider,
        f9Model,
        setF9Model,
        ["groq", "openai", "gemini", "openrouter", "ollama"] as AiProvider[],
        f9Provider === "groq"
          ? []
          : f9Provider === "openai"
            ? OPENAI_MODELS.map((m) => ({ id: m.id, label: m.label }))
            : f9Provider === "gemini"
              ? GEMINI_MODELS.map((m) => ({ id: m.id, label: m.label }))
              : f9Provider === "ollama"
                ? []
                : OPENROUTER_MODELS.map((m) => ({ id: m.id, label: m.label })),
        undefined,
        <OpenRouterModelPicker value={f9Model} onChange={setF9Model} catalog={orCatalog} catalogLoading={orCatalogLoading} catalogUpdatedAt={orCatalogUpdatedAt} onRefresh={() => void refreshOrCatalog()} />,
        f9Provider === "groq" ? (
          <GroqModelPicker value={f9Model} onChange={setF9Model} catalog={groqCatalog} loading={groqCatalogLoading} error={groqCatalogError} onRefresh={() => void refreshGroqCatalog(groqKey)} filter={["chat", "vision"]} />
        ) : f9Provider === "ollama" ? (
          <OllamaModelPicker value={f9Model} onChange={setF9Model} models={ollamaModels} loading={ollamaLoading} error={ollamaError} onRefresh={() => void refreshOllamaModels(ollamaBaseUrl)} />
        ) : undefined
      )}

      {taskRow("F10 — Transform selection", "Rewrites the selected text by your spoken instruction.", f10Provider, switchF10Provider, f10Model, setF10Model, ["groq", "openai", "gemini", "openrouter", "ollama"] as AiProvider[], f10Provider === "groq" || f10Provider === "ollama" ? [] : f10Provider === "openai" ? OPENAI_MODELS.map((m) => ({ id: m.id, label: m.label })) : f10Provider === "gemini" ? GEMINI_MODELS.map((m) => ({ id: m.id, label: m.label })) : OPENROUTER_MODELS.map((m) => ({ id: m.id, label: m.label })), undefined, <OpenRouterModelPicker value={f10Model} onChange={setF10Model} catalog={orCatalog} catalogLoading={orCatalogLoading} catalogUpdatedAt={orCatalogUpdatedAt} onRefresh={() => void refreshOrCatalog()} />, f10Provider === "groq" ? (
          <GroqModelPicker value={f10Model} onChange={setF10Model} catalog={groqCatalog} loading={groqCatalogLoading} error={groqCatalogError} onRefresh={() => void refreshGroqCatalog(groqKey)} filter={["chat", "vision"]} />
        ) : f10Provider === "ollama" ? (
          <OllamaModelPicker value={f10Model} onChange={setF10Model} models={ollamaModels} loading={ollamaLoading} error={ollamaError} onRefresh={() => void refreshOllamaModels(ollamaBaseUrl)} />
        ) : undefined)}

      {taskRow("Dictation cleanup", "F8 Light and Enhanced cleanup, including context-aware code, email, and list formatting. Verbatim skips this model.", polishProvider, switchPolishProvider, polishModel, setPolishModel, ["groq", "openai", "gemini", "openrouter", "ollama"] as AiProvider[], polishProvider === "groq" || polishProvider === "ollama" ? [] : polishProvider === "openai" ? OPENAI_MODELS.map((m) => ({ id: m.id, label: m.label })) : polishProvider === "gemini" ? GEMINI_MODELS.map((m) => ({ id: m.id, label: m.label })) : OPENROUTER_MODELS.map((m) => ({ id: m.id, label: m.label })), undefined, <OpenRouterModelPicker value={polishModel} onChange={setPolishModel} catalog={orCatalog} catalogLoading={orCatalogLoading} catalogUpdatedAt={orCatalogUpdatedAt} onRefresh={() => void refreshOrCatalog()} />, polishProvider === "groq" ? (
          <GroqModelPicker value={polishModel} onChange={setPolishModel} catalog={groqCatalog} loading={groqCatalogLoading} error={groqCatalogError} onRefresh={() => void refreshGroqCatalog(groqKey)} filter={["chat", "vision"]} />
        ) : polishProvider === "ollama" ? (
          <OllamaModelPicker value={polishModel} onChange={setPolishModel} models={ollamaModels} loading={ollamaLoading} error={ollamaError} onRefresh={() => void refreshOllamaModels(ollamaBaseUrl)} />
        ) : undefined)}
      </div>
    </div>
  );
}
