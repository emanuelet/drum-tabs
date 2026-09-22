import { library } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/vue-fontawesome";

// Add Free Font Awesome Icons
// https://fontawesome.com/v7/search?ic=free&o=r
// In order to add an icon, you have to:
// 1) add the icon name in the import statement below;
// 2) add the icon name to the library.add() statement below.
import {
    faArrowLeft,
    faArrowRightFromBracket,
    faArrowRightToBracket,
    faArrowUpRightFromSquare,
    faCaretDown,
    faCheck,
    faCompress,
    faDrum,
    faExpand,
    faFile,
    faFolder,
    faGaugeHigh,
    faGear,
    faHeadphones,
    faListOl,
    faMagnifyingGlass,
    faMagnifyingGlassMinus,
    faMagnifyingGlassPlus,
    faMusic,
    faPause,
    faPen,
    faPlay,
    faPlus,
    faRepeat,
    faRotateLeft,
    faStar,
    faStopwatch,
    faTrashCan,
    faVolumeHigh,
    faVolumeXmark,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { faStar as faStarRegular } from "@fortawesome/free-regular-svg-icons";

library.add([
    faFile,
    faFolder,
    faGear,
    faHeadphones,
    faArrowRightFromBracket,
    faCaretDown,
    faPlus,
    faPen,
    faPlay,
    faPause,
    faCheck,
    faCompress,
    faXmark,
    faArrowRightToBracket,
    faMagnifyingGlass,
    faMagnifyingGlassMinus,
    faMagnifyingGlassPlus,
    faMusic,
    faStar,
    faTrashCan,
    faStarRegular,
    faArrowLeft,
    faArrowUpRightFromSquare,
    faDrum,
    faExpand,
    faGaugeHigh,
    faListOl,
    faRepeat,
    faRotateLeft,
    faStopwatch,
    faVolumeHigh,
    faVolumeXmark,
]);

export { FontAwesomeIcon };
