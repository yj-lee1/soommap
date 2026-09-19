/** Brand illustration, deliberately not a geographical or crowd visualization. */
export function WalkArt() {
  return <svg className="walk-art" viewBox="0 0 300 210" fill="none" aria-hidden="true">
    <circle className="art-sun" cx="240" cy="49" r="31" fill="var(--sun)" />
    <path className="art-river" d="M-24 153C44 49 110 216 167 116S251 91 325 128" stroke="var(--river-light)" strokeWidth="34" />
    <path className="art-trail" d="M-24 153C44 49 110 216 167 116S251 91 325 128" stroke="#fff9df" strokeWidth="2" strokeDasharray="4 9" />
    <path className="art-leaf" d="M78 69C34 69 43 19 78 16C110 27 116 69 78 69Z" fill="#B9D963" />
    <path d="M78 39V93M78 64L93 46" stroke="#FFFAE7" strokeWidth="3" />
    <circle cx="171" cy="116" r="8" fill="var(--sun)" stroke="#16482E" strokeWidth="3" />
    <path d="M155 194H271" stroke="#B7D2B6" strokeWidth="1" />
    <text x="155" y="183" fill="#E0EBD5" fontSize="10" letterSpacing="2">A LITTLE SLOWER.</text>
  </svg>;
}
