<script setup lang="ts">
import { useGridFilters } from '~/composables/useGridFilters'

const {
  openFilterCol,
  filterDropdownPos,
  filterSearch,
  filteredUniqueValues,
  isAllSelected,
  isIndeterminate,
  isValueSelected,
  toggleSelectAll,
  toggleFilterValue,
  closeFilterDropdown,
  clearColFilter,
} = useGridFilters()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="openFilterCol"
      class="col-filter-overlay"
      @click="closeFilterDropdown"
    />
    <div
      v-if="openFilterCol"
      class="col-filter-dropdown"
      :style="{ top: filterDropdownPos.top + 'px', left: filterDropdownPos.left + 'px' }"
      @click.stop
    >
      <!-- Search -->
      <div class="cfd-search">
        <input
          v-model="filterSearch"
          class="cfd-search-input"
          placeholder="Search..."
          autofocus
        />
      </div>
      <!-- Select All -->
      <label class="cfd-row cfd-select-all">
        <input
          type="checkbox"
          :checked="isAllSelected(openFilterCol)"
          :indeterminate="isIndeterminate(openFilterCol)"
          @change="toggleSelectAll(openFilterCol)"
        />
        <span class="cfd-label">(Select All)</span>
      </label>
      <div class="cfd-divider" />
      <!-- Values -->
      <div class="cfd-values">
        <label
          v-for="val in filteredUniqueValues(openFilterCol)"
          :key="val"
          class="cfd-row"
        >
          <input
            type="checkbox"
            :checked="isValueSelected(openFilterCol, val)"
            @change="toggleFilterValue(openFilterCol, val)"
          />
          <span class="cfd-label">{{ val === '' ? '(Blank)' : val }}</span>
        </label>
      </div>
      <!-- Footer -->
      <div class="cfd-footer">
        <button class="cfd-clear-btn" @click="clearColFilter(openFilterCol)">Clear Filter</button>
        <button class="cfd-ok-btn" @click="closeFilterDropdown">OK</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.col-filter-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
}

.col-filter-dropdown {
  position: fixed;
  z-index: 1000;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.55);
  width: 200px;
  font-size: 0.82rem;
  overflow: hidden;
}

.cfd-search {
  padding: 0.45rem 0.5rem;
  border-bottom: 1px solid #2e2e2e;
}

.cfd-search-input {
  width: 100%;
  background: #111;
  border: 1px solid #333;
  border-radius: 4px;
  color: #ddd;
  font-size: 0.8rem;
  padding: 0.28rem 0.5rem;
  outline: none;
  box-sizing: border-box;
}

.cfd-search-input:focus { border-color: #555; }

.cfd-divider {
  height: 1px;
  background: #2e2e2e;
  margin: 0.15rem 0;
}

.cfd-select-all {
  font-weight: 600;
  color: #ccc;
}

.cfd-values {
  max-height: 180px;
  overflow-y: auto;
}

.cfd-values::-webkit-scrollbar { width: 4px; }
.cfd-values::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }

.cfd-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.28rem 0.6rem;
  cursor: pointer;
  color: #bbb;
  transition: background 0.1s;
}

.cfd-row:hover { background: rgba(255,255,255,0.06); }

.cfd-row input[type="checkbox"] {
  accent-color: #c87628;
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  cursor: pointer;
}

.cfd-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cfd-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0.6rem;
  border-top: 1px solid #2e2e2e;
  gap: 0.5rem;
}

.cfd-clear-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 0.76rem;
  cursor: pointer;
  padding: 0.2rem 0.3rem;
  border-radius: 3px;
  transition: color 0.1s;
}

.cfd-clear-btn:hover { color: #ccc; }

.cfd-ok-btn {
  background: #c87628;
  border: none;
  color: #fff;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.22rem 0.75rem;
  border-radius: 4px;
  transition: background 0.1s;
}

.cfd-ok-btn:hover { background: #d98830; }
</style>
