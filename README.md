# Zyllio MIDI Fixer Plugin

Ce dépôt implémente un plugin **Zyllio** contenant une action personnalisée permettant de normaliser, nettoyer et réparer des fichiers MIDI multi-pistes. Cette action est particulièrement utile pour rendre les fichiers MIDI compatibles avec des synthétiseurs physiques sensibles aux données complexes (ex: **Roland Fantom**).

---

## 1. Contrat de l'Action Zyllio

L'action est déclarée sous la version **Action V2** (`metadataVersion: 2`) avec l'identifiant unique **`documents-clean-midi`**.

### Propriétés (Properties)

| Identifiant | Libellé (FR) | Type | Par Défaut | Rôle | Écriture |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`file-url`** | URL MIDI D'origine | `text` | `""` | URL du fichier MIDI brut à nettoyer. | Non |
| **`value`** | URL MIDI Nettoyé | `text` | `""` | URL publique du fichier MIDI final traité. | **Oui** (Résultat) |
| **`keep-cc`** | Conserver les CC | `boolean` | `false` | Conserve les événements de type Control Change (modulation, volume, expression). | Non |
| **`dedupe-notes`** | Supprimer les doublons de notes | `boolean` | `true` | Supprime les notes identiques superposées. | Non |
| **`fix-overlaps`** | Résoudre les chevauchements | `boolean` | `true` | Corrige les notes consécutives d'une même hauteur qui se touchent. | Non |

### Transitions
*   **`complete`** : Retourné lorsque le traitement et le téléversement du fichier nettoyé se sont terminés avec succès.

---

## 2. Détail des Logiques Algorithmiques

Le traitement s'effectue en JavaScript côté client dans le navigateur. Il s'appuie sur la bibliothèque `midi-file` importée dynamiquement et applique les algorithmes suivants :

### A. Normalisation de la Résolution Temporelle (PPQN)
Certains fichiers MIDI possèdent des résolutions de ticks très élevées, provoquant des valeurs de durées négatives ou des anomalies lors de l'import sur du matériel hardware.
L'algorithme recalcule toutes les positions temporelles (les ticks absolus) vers la résolution cible (par défaut **960 ticks/beat**) via la formule :
$$\text{tick\_cible} = \text{round}\left(\frac{\text{tick\_origine} \times \text{PPQN\_cible}}{\text{PPQN\_origine}}\right)$$

### B. Classification des Pistes et Réaffectation des Canaux
Pour éviter les conflits d'instruments, le script réorganise l'attribution des canaux MIDI :
1.  **Détection de Batterie/Percussions** : Le canal MIDI 10 (index interne `9`) est réservé aux percussions. Une piste est classée comme percussion si son nom (dans les métadonnées textuelles) contient des termes clés comme `drums`, `percussion`, `perc`, `batterie`, etc. (via regex), ou si des notes sont déjà jouées sur le canal 10 d'origine.
2.  **Canaux Mélodiques** : Les pistes instrumentales mélodiques sont réaffectées de façon séquentielle aux 15 autres canaux MIDI disponibles : `[0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15]`. Si le fichier contient plus de 15 pistes mélodiques, un modulo réaffecte les canaux depuis le début.

### C. Consolidation des Événements Temporels
Les événements globaux de tempo (`setTempo`) et de signature rythmique (`timeSignature`) sont extraits de toutes les pistes d'origine, dédoublonnés (pour éviter les répétitions inutiles au même tick) et consolidés sur la **première piste instrumentale** (piste 0) du fichier reconstruit.

### D. Pairage des Notes et Notes Suspendues
Pour chaque piste instrumentale, le script apparie chaque événement d'allumage de note (`noteOn` avec vélocité > 0) avec son événement d'extinction (`noteOff` ou `noteOn` avec vélocité = 0) correspondant pour la même note :
*   Si une note est "suspendue" (aucun message d'extinction trouvé avant la fin de la piste), le script force sa fin au tick de fin de la piste (`endTime`).

### E. Dédoublonnage des Notes
Si deux notes identiques (même canal, même note, même début, même fin) sont présentes, le script ne conserve que celle ayant la vélocité la plus élevée. Si deux notes démarrent en même temps, celle ayant la vélocité maximale (ou la durée maximale en cas d'égalité) est conservée.

### F. Résolution des Chevauchements
Pour éviter que deux notes consécutives de même hauteur sur un même canal ne se chevauchent ou ne s'éteignent/s'allument au même tick (ce qui peut empêcher certains synthétiseurs physiques de re-déclencher la note), le script raccourcit la première note :
*   Sa fin est ajustée à : `fin_note_1 = debut_note_2 - 1`.
*   Si cet ajustement réduit la durée de la note à 0 ou moins, la note 1 est tout simplement supprimée.

---

## 3. Installation dans Zyllio Studio

1.  Ouvrez votre application dans **Zyllio Studio**.
2.  Accédez au panneau **Concepteur / Plugins**.
3.  Ajoutez le fichier JavaScript du plugin : `src/plugin.js`.
4.  L'action **Nettoyer fichier MIDI** apparaîtra dans votre catalogue d'actions sous la catégorie **Documents**.
