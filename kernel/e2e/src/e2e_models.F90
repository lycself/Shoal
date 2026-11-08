#include "fabm_driver.h"

!-----------------------------------------------------------------------
! Shoal implementation of the ECOSMO E2E v2.0 higher-trophic-level
! modules (fish and macrobenthos functional groups), written from the
! equations published in
!
!   Vijayakumaran et al. (2026) ECOSMO E2E v2.0: Generic modules of
!   higher-trophic-level fish and macrobenthos functional groups ...
!   EGUsphere, doi:10.5194/egusphere-2026-3078   (Eqs. 1-19, Tables 1-3)
!
! This is NOT the official ECOSMO E2E code (Zenodo 10.5281/zenodo.20413770).
! When the official code is placed in kernel/src/ecosmo-e2e, kernel/build.py
! compiles that instead.
!
! Conventions
!   internal currency: carbon in mg C, nitrogen/phosphorus/silicon in mmol,
!   oxygen in mmol O2. Every prey constituent and waste target carries a
!   scale factor converting host units to internal units (prey) or internal
!   units to host units (targets), so the modules couple to ECOSMO (mg C),
!   ERSEM (mg C + mmol N/P/Si) and ERGOM (mmol N) without recompilation.
!
!   fish        horizontal (depth-integrated) state, mg C m-2. Feeding uses
!               vertically integrated prey (Eq. 6-10); losses of pelagic prey
!               are applied at every depth in proportion to local prey
!               (Eq. 14); waste is distributed vertically following the
!               preference-weighted prey distribution (fish follow food).
!   macrobenthos bottom state, mg C m-2, feeding on the bottom-cell prey and on
!               sediment organic matter (Eq. 1-5, 13, 16-19).
!
! Mass conservation: ingested C, N and P are tracked separately; somatic
! growth is limited by the scarcest element at the predator's fixed
! stoichiometry (as in FABM-MIZER), excess assimilated C is respired, excess
! N and P are excreted as NH4 and PO4.
!-----------------------------------------------------------------------
module e2e_models

   use fabm_types
   use fabm_builtin_depth_integral

   implicit none

   private

   public type_e2e_fish, type_e2e_macrobenthos

   real(rk), parameter :: CMass = 12.011_rk                 ! mg C per mmol C
   real(rk), parameter :: Boltzmann = 8.617333262e-5_rk     ! eV K-1
   real(rk), parameter :: Kelvin0 = 273.15_rk
   real(rk), parameter :: sec_per_day = 86400.0_rk
   real(rk), parameter :: redfield_n = 16.0_rk / 106.0_rk / CMass  ! mmol N per mg C
   real(rk), parameter :: redfield_p = 1.0_rk / 106.0_rk / CMass   ! mmol P per mg C

   ! ---------------------------------------------------------------
   ! Prey description
   ! ---------------------------------------------------------------
   type type_prey
      logical  :: benthic = .false.
      real(rk) :: sigma = 0.0_rk      ! grazing rate (s-1)
      real(rk) :: a     = 0.0_rk      ! feeding preference (-)
      real(rk) :: cs = 1.0_rk, ns = 1.0_rk, ps = 1.0_rk, ss = 1.0_rk ! host unit -> internal unit
      real(rk) :: qn = redfield_n, qp = redfield_p                    ! used when n/p not tracked
      logical  :: has_n = .false., has_p = .false., has_s = .false., has_chl = .false.
      type (type_state_variable_id)        :: id_c, id_n, id_p, id_s, id_chl  ! pelagic prey
      type (type_bottom_state_variable_id) :: idb_c, idb_n, idb_p             ! benthic prey
   end type

   ! Waste target (one constituent)
   type type_target
      logical  :: on = .false.
      real(rk) :: scale = 1.0_rk      ! internal unit -> host unit
      type (type_state_variable_id)        :: id
      type (type_bottom_state_variable_id) :: idb
   end type

   type type_targets
      type (type_target) :: det_c, det_n, det_p, det_s
      type (type_target) :: dom_c, dom_n, dom_p
      type (type_target) :: nh4, po4, dic, o2
   end type

   ! ---------------------------------------------------------------
   ! Child model: preference-weighted prey densities at every depth
   ! ---------------------------------------------------------------
   type, extends(type_base_model) :: type_food_density
      integer :: nprey = 0
      type (type_prey), pointer :: prey(:) => null()
      type (type_dependency_id), allocatable :: id_c(:), id_n(:), id_p(:)
      type (type_dependency_id) :: id_T
      type (type_diagnostic_variable_id) :: id_food, id_Tfood, id_gc, id_gn, id_gp
   contains
      procedure :: initialize => food_initialize
      procedure :: do         => food_do
   end type

   ! ---------------------------------------------------------------
   ! Shared HTL base
   ! ---------------------------------------------------------------
   type, extends(type_base_model), abstract :: type_e2e_base
      integer  :: nprey = 0
      type (type_prey), pointer :: prey(:) => null()
      type (type_targets) :: t
      real(rk) :: gamma, m, mu_exc, theta, alpha_dom, qn, qp, o2c, ww2c, fishing
      real(rk) :: r_pel, r_ben, kmax, max_sa_pel = 0.0_rk
      type (type_bottom_state_variable_id) :: id_c, id_landings
      type (type_horizontal_diagnostic_variable_id) :: id_cons, id_growth, id_exc, id_mort, id_ww, id_food_tot, id_T_exp
      type (type_dependency_id) :: id_T
   contains
      procedure :: read_common
      procedure :: register_targets
   end type

   type, extends(type_e2e_base) :: type_e2e_fish
      type (type_horizontal_dependency_id) :: id_F_pel, id_TW, id_GC, id_GN, id_GP, id_H
      type (type_dependency_id)            :: id_food
   contains
      procedure :: initialize => fish_initialize
      procedure :: do         => fish_do
      procedure :: do_bottom  => fish_do_bottom
   end type

   type, extends(type_e2e_base) :: type_e2e_macrobenthos
   contains
      procedure :: initialize => mb_initialize
      procedure :: do_bottom  => mb_do_bottom
   end type

   ! Column budget shared by do / do_bottom
   type type_budget
      real(rk) :: I_C, I_N, I_P, growth
      real(rk) :: det_c, det_n, det_p, dom_c, dom_n, dom_p, nh4, po4, dic, o2
      real(rk) :: mort, exc, fish
   end type

contains

   ! ===============================================================
   ! Common parameters, prey and targets
   ! ===============================================================
   subroutine read_common(self, pelagic_feeding_on_column)
      class (type_e2e_base), intent(inout), target :: self
      logical, intent(in) :: pelagic_feeding_on_column

      integer :: i
      character(len=8)  :: idx
      character(len=16) :: comp
      real(rk) :: c_ini

      call self%get_parameter(c_ini, 'c_ini', 'mg C m-2', 'initial biomass', default=100.0_rk, minimum=0.0_rk)
      call self%get_parameter(self%gamma, 'gamma', '-', 'assimilation efficiency', default=0.7_rk, minimum=0.0_rk, maximum=1.0_rk)
      call self%get_parameter(self%m, 'm', 'd-1', 'mortality rate', default=0.001_rk, minimum=0.0_rk, scale_factor=1.0_rk/sec_per_day)
      call self%get_parameter(self%mu_exc, 'mu', 'd-1', 'excretion rate at 0 degC', default=0.001_rk, minimum=0.0_rk, scale_factor=1.0_rk/sec_per_day)
      call self%get_parameter(self%theta, 'theta', 'eV', 'temperature control of excretion (activation energy)', default=0.0_rk)
      call self%get_parameter(self%alpha_dom, 'alpha_dom', '-', 'fraction of unassimilated food and mortality going to DOM', default=0.3_rk, minimum=0.0_rk, maximum=1.0_rk)
      call self%get_parameter(self%qn, 'qn', 'mmol N (mg C)-1', 'nitrogen to carbon ratio of biomass', default=redfield_n, minimum=0.0_rk)
      call self%get_parameter(self%qp, 'qp', 'mmol P (mg C)-1', 'phosphorus to carbon ratio of biomass', default=redfield_p, minimum=0.0_rk)
      call self%get_parameter(self%o2c, 'o2c', 'mol O2 (mol C)-1', 'oxygen consumed per carbon respired (c_C:O2)', default=1.0_rk, minimum=0.0_rk)
      call self%get_parameter(self%ww2c, 'ww2c', 'g C (g WW)-1', 'carbon to wet mass ratio', default=0.1_rk, minimum=0.0_rk)
      call self%get_parameter(self%fishing, 'fishing', 'd-1', 'fishing mortality (removed as landings)', default=0.0_rk, minimum=0.0_rk, scale_factor=1.0_rk/sec_per_day)
      call self%get_parameter(self%r_pel, 'r', 'mmol C m-3', 'grazing half-saturation (pelagic prey)', default=0.7_rk, minimum=0.0_rk, scale_factor=CMass)
      call self%get_parameter(self%r_ben, 'r_ben', 'mmol C m-3', 'grazing half-saturation (benthic prey)', default=self%r_pel/CMass, minimum=0.0_rk, scale_factor=CMass)
      call self%get_parameter(self%kmax, 'kmax', 'd-1', 'maximum specific predation loss of any prey (numerical safeguard)', default=1.0_rk, minimum=0.0_rk, scale_factor=1.0_rk/sec_per_day)
      call self%get_parameter(self%nprey, 'nprey', '', 'number of prey', minimum=0)

      call self%register_state_variable(self%id_c, 'c', 'mg C m-2', 'carbon biomass', c_ini, minimum=0.0_rk)
      call self%add_to_aggregate_variable(standard_variables%total_carbon, self%id_c, scale_factor=1.0_rk/CMass)
      call self%add_to_aggregate_variable(standard_variables%total_nitrogen, self%id_c, scale_factor=self%qn)
      call self%add_to_aggregate_variable(standard_variables%total_phosphorus, self%id_c, scale_factor=self%qp)
      call self%register_state_variable(self%id_landings, 'landings', 'mg C m-2', 'cumulative landed carbon', 0.0_rk, minimum=0.0_rk)
      call self%register_dependency(self%id_T, standard_variables%temperature)

      allocate(self%prey(self%nprey))
      do i = 1, self%nprey
         write (idx, '(i0)') i
         associate (p => self%prey(i))
         call self%get_parameter(p%benthic, 'prey'//trim(idx)//'_benthic', '', 'prey '//trim(idx)//' is a benthic/depth-integrated variable', default=.false.)
         call self%get_parameter(p%sigma, 'prey'//trim(idx)//'_sigma', 'd-1', 'grazing rate on prey '//trim(idx), minimum=0.0_rk, scale_factor=1.0_rk/sec_per_day)
         call self%get_parameter(p%a, 'prey'//trim(idx)//'_a', '-', 'feeding preference for prey '//trim(idx), minimum=0.0_rk)
         call self%get_parameter(p%cs, 'prey'//trim(idx)//'_c_scale', 'mg C per host unit', 'carbon scale of prey '//trim(idx), default=1.0_rk)
         call self%get_parameter(p%qn, 'prey'//trim(idx)//'_qn', 'mmol N (mg C)-1', 'N:C of prey '//trim(idx)//' when nitrogen is not tracked', default=redfield_n)
         call self%get_parameter(p%qp, 'prey'//trim(idx)//'_qp', 'mmol P (mg C)-1', 'P:C of prey '//trim(idx)//' when phosphorus is not tracked', default=redfield_p)
         call self%get_parameter(comp, 'prey'//trim(idx)//'_composition', '', 'constituents of prey '//trim(idx)//' (c, n, p, s, l=chlorophyll)', default='c')
         if (p%benthic) then
            call self%register_state_dependency(p%idb_c, 'prey'//trim(idx)//'_c', 'host units', 'carbon in prey '//trim(idx))
            p%has_n = index(comp, 'n') > 0
            p%has_p = index(comp, 'p') > 0
            if (p%has_n) then
               call self%get_parameter(p%ns, 'prey'//trim(idx)//'_n_scale', 'mmol N per host unit', 'nitrogen scale of prey '//trim(idx), default=1.0_rk)
               call self%register_state_dependency(p%idb_n, 'prey'//trim(idx)//'_n', 'host units', 'nitrogen in prey '//trim(idx))
            end if
            if (p%has_p) then
               call self%get_parameter(p%ps, 'prey'//trim(idx)//'_p_scale', 'mmol P per host unit', 'phosphorus scale of prey '//trim(idx), default=1.0_rk)
               call self%register_state_dependency(p%idb_p, 'prey'//trim(idx)//'_p', 'host units', 'phosphorus in prey '//trim(idx))
            end if
         else
            p%has_n = index(comp, 'n') > 0
            p%has_p = index(comp, 'p') > 0
            p%has_s = index(comp, 's') > 0
            p%has_chl = index(comp, 'l') > 0
            call self%register_state_dependency(p%id_c, 'prey'//trim(idx)//'_c', 'host units', 'carbon in prey '//trim(idx))
            if (p%has_n) then
               call self%get_parameter(p%ns, 'prey'//trim(idx)//'_n_scale', 'mmol N per host unit', 'nitrogen scale of prey '//trim(idx), default=1.0_rk)
               call self%register_state_dependency(p%id_n, 'prey'//trim(idx)//'_n', 'host units', 'nitrogen in prey '//trim(idx))
            end if
            if (p%has_p) then
               call self%get_parameter(p%ps, 'prey'//trim(idx)//'_p_scale', 'mmol P per host unit', 'phosphorus scale of prey '//trim(idx), default=1.0_rk)
               call self%register_state_dependency(p%id_p, 'prey'//trim(idx)//'_p', 'host units', 'phosphorus in prey '//trim(idx))
            end if
            if (p%has_s) then
               call self%get_parameter(p%ss, 'prey'//trim(idx)//'_s_scale', 'mmol Si per host unit', 'silicon scale of prey '//trim(idx), default=1.0_rk)
               call self%register_state_dependency(p%id_s, 'prey'//trim(idx)//'_s', 'host units', 'silicon in prey '//trim(idx))
            end if
            if (p%has_chl) call self%register_state_dependency(p%id_chl, 'prey'//trim(idx)//'_chl', 'host units', 'chlorophyll in prey '//trim(idx))
         end if
         if (.not. p%benthic) self%max_sa_pel = max(self%max_sa_pel, p%sigma * p%a)
         end associate
      end do

      call self%register_diagnostic_variable(self%id_cons, 'consumption', 'mg C m-2 d-1', 'total consumption', source=source_do_bottom)
      call self%register_diagnostic_variable(self%id_growth, 'production', 'mg C m-2 d-1', 'somatic production', source=source_do_bottom)
      call self%register_diagnostic_variable(self%id_exc, 'excretion', 'mg C m-2 d-1', 'excretion (respiration)', source=source_do_bottom)
      call self%register_diagnostic_variable(self%id_mort, 'mortality', 'mg C m-2 d-1', 'natural mortality', source=source_do_bottom)
      call self%register_diagnostic_variable(self%id_ww, 'wet_mass', 'g WW m-2', 'wet mass', source=source_do_bottom)
      call self%register_diagnostic_variable(self%id_food_tot, 'food', 'mg C m-2', 'preference-weighted available food', source=source_do_bottom)
      call self%register_diagnostic_variable(self%id_T_exp, 'T_exp', 'degrees_Celsius', 'experienced temperature', source=source_do_bottom)
      if (.false. .and. pelagic_feeding_on_column) continue
   end subroutine read_common

   subroutine register_targets(self, sediment_targets)
      class (type_e2e_base), intent(inout), target :: self
      logical, intent(in) :: sediment_targets   ! detritus targets are bottom (sediment) variables

      character(len=16) :: comp

      call self%get_parameter(comp, 'det_composition', '', 'constituents of the detritus/sediment target (c, n, p, s)', default='c')
      call target(self%t%det_c, 'det_c', 'carbon', index(comp, 'c') > 0, sediment_targets)
      call target(self%t%det_n, 'det_n', 'nitrogen', index(comp, 'n') > 0, sediment_targets)
      call target(self%t%det_p, 'det_p', 'phosphorus', index(comp, 'p') > 0, sediment_targets)
      call target(self%t%det_s, 'det_s', 'silicon', index(comp, 's') > 0, sediment_targets)
      call self%get_parameter(comp, 'dom_composition', '', 'constituents of the DOM target (c, n, p; empty = none)', default='c')
      call target(self%t%dom_c, 'dom_c', 'carbon', index(comp, 'c') > 0, .false.)
      call target(self%t%dom_n, 'dom_n', 'nitrogen', index(comp, 'n') > 0, .false.)
      call target(self%t%dom_p, 'dom_p', 'phosphorus', index(comp, 'p') > 0, .false.)
      call self%get_parameter(comp, 'excretion_targets', '', 'nutrient targets: a=NH4, p=PO4, c=DIC, o=O2', default='ap')
      call target(self%t%nh4, 'nh4', 'ammonium (mmol N internal)', index(comp, 'a') > 0, .false.)
      call target(self%t%po4, 'po4', 'phosphate (mmol P internal)', index(comp, 'p') > 0, .false.)
      call target(self%t%dic, 'dic', 'dissolved inorganic carbon (mg C internal)', index(comp, 'c') > 0, .false.)
      call target(self%t%o2,  'o2',  'oxygen (mmol O2 internal)', index(comp, 'o') > 0, .false.)

   contains

      subroutine target(t, name, long_name, on, bottom)
         type (type_target), intent(inout), target :: t
         character(len=*), intent(in) :: name, long_name
         logical, intent(in) :: on, bottom
         t%on = on
         if (.not. on) return
         call self%get_parameter(t%scale, name//'_scale', 'host unit per internal unit', 'unit conversion for target '//name, default=1.0_rk)
         if (bottom) then
            call self%register_state_dependency(t%idb, name, 'host units', 'target for '//long_name)
         else
            call self%register_state_dependency(t%id, name, 'host units', 'target for '//long_name)
         end if
      end subroutine
   end subroutine register_targets

   ! Temperature factor of excretion (Eq. 4 and 11)
   pure real(rk) function excretion_rate(mu, theta, T) result(e)
      real(rk), intent(in) :: mu, theta, T
      real(rk) :: TK
      TK = T + Kelvin0
      e = mu * exp(theta / Boltzmann * (TK - Kelvin0) / (TK * Kelvin0))
   end function

   ! Element budget given ingestion (column totals or per area)
   subroutine budget(self, C, I_C, I_N, I_P, T, b)
      class (type_e2e_base), intent(in) :: self
      real(rk), intent(in) :: C, I_C, I_N, I_P, T
      type (type_budget), intent(out) :: b

      real(rk) :: A_C, A_N, A_P, ex_C, ex_N, ex_P, un_C, un_N, un_P, mort, exc

      b%I_C = I_C; b%I_N = I_N; b%I_P = I_P
      A_C = self%gamma * I_C
      A_N = self%gamma * I_N
      A_P = self%gamma * I_P
      b%growth = max(0.0_rk, min(A_C, A_N / max(self%qn, 1e-30_rk), A_P / max(self%qp, 1e-30_rk)))
      ex_C = A_C - b%growth
      ex_N = A_N - self%qn * b%growth
      ex_P = A_P - self%qp * b%growth
      un_C = I_C - A_C
      un_N = I_N - A_N
      un_P = I_P - A_P
      mort = self%m * C
      exc = excretion_rate(self%mu_exc, self%theta, T) * C
      b%mort = mort
      b%exc = exc
      b%fish = self%fishing * C
      b%det_c = (1.0_rk - self%alpha_dom) * (un_C + mort)
      b%det_n = (1.0_rk - self%alpha_dom) * (un_N + self%qn * mort)
      b%det_p = (1.0_rk - self%alpha_dom) * (un_P + self%qp * mort)
      b%dom_c = self%alpha_dom * (un_C + mort)
      b%dom_n = self%alpha_dom * (un_N + self%qn * mort)
      b%dom_p = self%alpha_dom * (un_P + self%qp * mort)
      ! DOM fallbacks: if no DOM target for an element, send it to detritus
      if (.not. self%t%dom_c%on) b%det_c = b%det_c + b%dom_c
      if (.not. self%t%dom_n%on) b%det_n = b%det_n + b%dom_n
      if (.not. self%t%dom_p%on) b%det_p = b%det_p + b%dom_p
      b%nh4 = ex_N + self%qn * exc
      b%po4 = ex_P + self%qp * exc
      b%dic = ex_C + exc
      b%o2 = -(ex_C + exc) / CMass * self%o2c
   end subroutine budget

   ! ===============================================================
   ! Food density child
   ! ===============================================================
   subroutine food_initialize(self, configunit)
      class (type_food_density), intent(inout), target :: self
      integer, intent(in) :: configunit
      integer :: i
      character(len=8) :: idx

      allocate(self%id_c(self%nprey), self%id_n(self%nprey), self%id_p(self%nprey))
      do i = 1, self%nprey
         if (self%prey(i)%benthic) cycle
         write (idx, '(i0)') i
         call self%register_dependency(self%id_c(i), 'prey'//trim(idx)//'_c', 'host units', 'carbon in prey '//trim(idx))
         if (self%prey(i)%has_n) call self%register_dependency(self%id_n(i), 'prey'//trim(idx)//'_n', 'host units', 'nitrogen in prey '//trim(idx))
         if (self%prey(i)%has_p) call self%register_dependency(self%id_p(i), 'prey'//trim(idx)//'_p', 'host units', 'phosphorus in prey '//trim(idx))
      end do
      call self%register_dependency(self%id_T, standard_variables%temperature)
      call self%register_diagnostic_variable(self%id_food, 'food', 'mg C m-3', 'preference-weighted pelagic food', output=output_none)
      call self%register_diagnostic_variable(self%id_Tfood, 'Tfood', 'degC mg C m-3', 'temperature x food', output=output_none)
      call self%register_diagnostic_variable(self%id_gc, 'grz_c', 'mg C m-3 s-1', 'potential carbon grazing density', output=output_none)
      call self%register_diagnostic_variable(self%id_gn, 'grz_n', 'mmol N m-3 s-1', 'potential nitrogen grazing density', output=output_none)
      call self%register_diagnostic_variable(self%id_gp, 'grz_p', 'mmol P m-3 s-1', 'potential phosphorus grazing density', output=output_none)
   end subroutine food_initialize

   subroutine food_do(self, _ARGUMENTS_DO_)
      class (type_food_density), intent(in) :: self
      _DECLARE_ARGUMENTS_DO_
      integer :: i
      real(rk) :: c, n, p, T, food, gc, gn, gp

      _LOOP_BEGIN_
         food = 0.0_rk; gc = 0.0_rk; gn = 0.0_rk; gp = 0.0_rk
         do i = 1, self%nprey
            associate (q => self%prey(i))
            if (q%benthic) cycle
            _GET_(self%id_c(i), c)
            c = max(c, 0.0_rk) * q%cs
            if (q%has_n) then
               _GET_(self%id_n(i), n)
               n = max(n, 0.0_rk) * q%ns
            else
               n = q%qn * c
            end if
            if (q%has_p) then
               _GET_(self%id_p(i), p)
               p = max(p, 0.0_rk) * q%ps
            else
               p = q%qp * c
            end if
            food = food + q%a * c
            gc = gc + q%sigma * q%a * c
            gn = gn + q%sigma * q%a * n
            gp = gp + q%sigma * q%a * p
            end associate
         end do
         _GET_(self%id_T, T)
         _SET_DIAGNOSTIC_(self%id_food, food)
         _SET_DIAGNOSTIC_(self%id_Tfood, T * food)
         _SET_DIAGNOSTIC_(self%id_gc, gc)
         _SET_DIAGNOSTIC_(self%id_gn, gn)
         _SET_DIAGNOSTIC_(self%id_gp, gp)
      _LOOP_END_
   end subroutine food_do

   ! ===============================================================
   ! Fish functional group
   ! ===============================================================
   subroutine fish_initialize(self, configunit)
      class (type_e2e_fish), intent(inout), target :: self
      integer, intent(in) :: configunit

      class (type_food_density), pointer :: food
      integer :: i
      character(len=8) :: idx

      call self%read_common(.true.)
      call self%register_targets(.false.)

      allocate(food)
      food%nprey = self%nprey
      food%prey => self%prey
      call self%add_child(food, 'food_density', configunit=-1)
      do i = 1, self%nprey
         if (self%prey(i)%benthic) cycle
         write (idx, '(i0)') i
         call food%request_coupling('prey'//trim(idx)//'_c', '../prey'//trim(idx)//'_c')
         if (self%prey(i)%has_n) call food%request_coupling('prey'//trim(idx)//'_n', '../prey'//trim(idx)//'_n')
         if (self%prey(i)%has_p) call food%request_coupling('prey'//trim(idx)//'_p', '../prey'//trim(idx)//'_p')
      end do

      call add_integral('food', self%id_F_pel, 'F_pel', 'depth-integrated preference-weighted food')
      call add_integral('Tfood', self%id_TW, 'TW', 'depth-integrated temperature x food')
      call add_integral('grz_c', self%id_GC, 'GC', 'depth-integrated potential carbon grazing')
      call add_integral('grz_n', self%id_GN, 'GN', 'depth-integrated potential nitrogen grazing')
      call add_integral('grz_p', self%id_GP, 'GP', 'depth-integrated potential phosphorus grazing')
      call self%register_dependency(self%id_food, 'food_local', 'mg C m-3', 'local preference-weighted food')
      call self%request_coupling(self%id_food, './food_density/food')
      call self%register_dependency(self%id_H, standard_variables%bottom_depth)

   contains

      subroutine add_integral(source, id, name, long_name)
         character(len=*), intent(in) :: source, name, long_name
         type (type_horizontal_dependency_id), intent(inout), target :: id
         class (type_depth_integral), pointer :: integral
         allocate(integral)
         call self%add_child(integral, 'int_'//source, configunit=-1)
         call integral%request_coupling('source', '../food_density/'//source)
         integral%id_output%link%target%output = output_none
         call self%register_dependency(id, name, '', long_name)
         call self%request_coupling(id, './int_'//source//'/result')
      end subroutine
   end subroutine fish_initialize

   ! Column ingestion of fish (pelagic via integrals, benthic directly)
   ! Functional response on depth-averaged food (r in mg C m-3, food averaged over the column of height H):
   !   G_X = sigma a (P_X/H) / (r + F/H)  ->  loss of prey X at depth z: C_fish sigma a C_X(z) / (r H + F)
   subroutine fish_ingestion(self, C, H, F_pel, GC, GN, GP, ben_c, I_C, I_N, I_P, kpel)
      class (type_e2e_fish), intent(in) :: self
      real(rk), intent(in)  :: C, H, F_pel, GC, GN, GP, ben_c(:)
      real(rk), intent(out) :: I_C, I_N, I_P, kpel
      integer  :: i
      real(rk) :: F_ben, kb

      kpel = C / (self%r_pel * H + max(F_pel, 0.0_rk))      ! multiplies sigma*a for pelagic prey
      kpel = min(kpel, self%kmax / max(self%max_sa_pel, 1e-30_rk))
      I_C = kpel * max(GC, 0.0_rk)
      I_N = kpel * max(GN, 0.0_rk)
      I_P = kpel * max(GP, 0.0_rk)
      F_ben = 0.0_rk
      do i = 1, self%nprey
         if (self%prey(i)%benthic) F_ben = F_ben + self%prey(i)%a * ben_c(i)
      end do
      do i = 1, self%nprey
         if (.not. self%prey(i)%benthic) cycle
         kb = min(C * self%prey(i)%sigma * self%prey(i)%a / (self%r_ben * H + F_ben), self%kmax)
         I_C = I_C + kb * ben_c(i)
         I_N = I_N + kb * self%prey(i)%qn * ben_c(i)
         I_P = I_P + kb * self%prey(i)%qp * ben_c(i)
      end do
   end subroutine fish_ingestion

   subroutine fish_do(self, _ARGUMENTS_DO_)
      class (type_e2e_fish), intent(in) :: self
      _DECLARE_ARGUMENTS_DO_

      integer  :: i
      real(rk) :: C, F_pel, TW, GC, GN, GP, H, food, f, kpel, k, v, T_exp
      real(rk) :: I_C, I_N, I_P
      real(rk) :: ben_c(self%nprey)
      type (type_budget) :: b

      _LOOP_BEGIN_
         _GET_HORIZONTAL_(self%id_c, C)
         C = max(C, 0.0_rk)
         _GET_HORIZONTAL_(self%id_F_pel, F_pel)
         _GET_HORIZONTAL_(self%id_TW, TW)
         _GET_HORIZONTAL_(self%id_GC, GC)
         _GET_HORIZONTAL_(self%id_GN, GN)
         _GET_HORIZONTAL_(self%id_GP, GP)
         _GET_HORIZONTAL_(self%id_H, H)
         H = max(H, 1e-3_rk)
         _GET_(self%id_food, food)
         ben_c = 0.0_rk
         do i = 1, self%nprey
            if (self%prey(i)%benthic) then
               _GET_HORIZONTAL_(self%prey(i)%idb_c, v)
               ben_c(i) = max(v, 0.0_rk) * self%prey(i)%cs
            end if
         end do
         call fish_ingestion(self, C, H, F_pel, GC, GN, GP, ben_c, I_C, I_N, I_P, kpel)
         if (F_pel > 1e-12_rk) then
            T_exp = TW / F_pel
            f = max(food, 0.0_rk) / F_pel
         else
            _GET_(self%id_T, T_exp)
            f = 1.0_rk / H
         end if
         call budget(self, C, I_C, I_N, I_P, T_exp, b)

         ! Losses of pelagic prey at this depth (Eq. 14): same specific rate for every constituent
         do i = 1, self%nprey
            associate (q => self%prey(i))
            if (q%benthic) cycle
            k = kpel * q%sigma * q%a
            _GET_(q%id_c, v)
            _ADD_SOURCE_(q%id_c, -k * max(v, 0.0_rk))
            if (q%has_n) then
               _GET_(q%id_n, v)
               _ADD_SOURCE_(q%id_n, -k * max(v, 0.0_rk))
            end if
            if (q%has_p) then
               _GET_(q%id_p, v)
               _ADD_SOURCE_(q%id_p, -k * max(v, 0.0_rk))
            end if
            if (q%has_s) then
               ! silicon is not part of fish biomass: egested immediately at the same depth
               _GET_(q%id_s, v)
               _ADD_SOURCE_(q%id_s, -k * max(v, 0.0_rk))
               if (self%t%det_s%on) then
                  _ADD_SOURCE_(self%t%det_s%id, k * max(v, 0.0_rk) * q%ss * self%t%det_s%scale)
               end if
            end if
            if (q%has_chl) then
               _GET_(q%id_chl, v)
               _ADD_SOURCE_(q%id_chl, -k * max(v, 0.0_rk))
            end if
            end associate
         end do

         ! Waste distributed following food (Eq. 15-19)
         call put(self%t%det_c, b%det_c * f)
         call put(self%t%det_n, b%det_n * f)
         call put(self%t%det_p, b%det_p * f)
         call put(self%t%dom_c, b%dom_c * f)
         call put(self%t%dom_n, b%dom_n * f)
         call put(self%t%dom_p, b%dom_p * f)
         call put(self%t%nh4, b%nh4 * f)
         call put(self%t%po4, b%po4 * f)
         call put(self%t%dic, b%dic * f)
         call put(self%t%o2, b%o2 * f)
      _LOOP_END_

   contains

      subroutine put(t, value)
         type (type_target), intent(in) :: t
         real(rk), intent(in) :: value
         if (t%on) then
            _ADD_SOURCE_(t%id, value * t%scale)
         end if
      end subroutine
   end subroutine fish_do

   subroutine fish_do_bottom(self, _ARGUMENTS_DO_BOTTOM_)
      class (type_e2e_fish), intent(in) :: self
      _DECLARE_ARGUMENTS_DO_BOTTOM_

      integer  :: i
      real(rk) :: C, F_pel, TW, GC, GN, GP, kpel, v, T_exp, F_ben, kb, H
      real(rk) :: I_C, I_N, I_P
      real(rk) :: ben_c(self%nprey)
      type (type_budget) :: b

      _BOTTOM_LOOP_BEGIN_
         _GET_HORIZONTAL_(self%id_c, C)
         C = max(C, 0.0_rk)
         _GET_HORIZONTAL_(self%id_H, H)
         H = max(H, 1e-3_rk)
         _GET_HORIZONTAL_(self%id_F_pel, F_pel)
         _GET_HORIZONTAL_(self%id_TW, TW)
         _GET_HORIZONTAL_(self%id_GC, GC)
         _GET_HORIZONTAL_(self%id_GN, GN)
         _GET_HORIZONTAL_(self%id_GP, GP)
         ben_c = 0.0_rk
         F_ben = 0.0_rk
         do i = 1, self%nprey
            if (self%prey(i)%benthic) then
               _GET_HORIZONTAL_(self%prey(i)%idb_c, v)
               ben_c(i) = max(v, 0.0_rk) * self%prey(i)%cs
               F_ben = F_ben + self%prey(i)%a * ben_c(i)
            end if
         end do
         call fish_ingestion(self, C, H, F_pel, GC, GN, GP, ben_c, I_C, I_N, I_P, kpel)
         if (F_pel > 1e-12_rk) then
            T_exp = TW / F_pel
         else
            _GET_(self%id_T, T_exp)     ! bottom-cell temperature as fallback
         end if
         call budget(self, C, I_C, I_N, I_P, T_exp, b)

         _ADD_BOTTOM_SOURCE_(self%id_c, b%growth - b%mort - b%exc - b%fish)
         _ADD_BOTTOM_SOURCE_(self%id_landings, b%fish)

         ! Losses of benthic / depth-integrated prey (macrobenthos, other fish)
         do i = 1, self%nprey
            if (.not. self%prey(i)%benthic) cycle
            kb = min(C * self%prey(i)%sigma * self%prey(i)%a / (self%r_ben * H + F_ben), self%kmax)
            _ADD_BOTTOM_SOURCE_(self%prey(i)%idb_c, -kb * ben_c(i) / self%prey(i)%cs)
         end do

         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_cons, I_C * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_growth, b%growth * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_exc, b%exc * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_mort, b%mort * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_ww, C * 1e-3_rk / self%ww2c)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_food_tot, F_pel + F_ben)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_T_exp, T_exp)
      _BOTTOM_LOOP_END_
   end subroutine fish_do_bottom

   ! ===============================================================
   ! Macrobenthos functional group
   ! ===============================================================
   subroutine mb_initialize(self, configunit)
      class (type_e2e_macrobenthos), intent(inout), target :: self
      integer, intent(in) :: configunit

      call self%read_common(.false.)
      call self%register_targets(.true.)   ! detritus target = sediment (bottom) pool, Eq. 17
   end subroutine mb_initialize

   subroutine mb_do_bottom(self, _ARGUMENTS_DO_BOTTOM_)
      class (type_e2e_macrobenthos), intent(in) :: self
      _DECLARE_ARGUMENTS_DO_BOTTOM_

      integer  :: i
      real(rk) :: C, T, F, v, n, p, k, I_C, I_N, I_P
      real(rk) :: cc(self%nprey), cn(self%nprey), cp(self%nprey)
      type (type_budget) :: b

      _BOTTOM_LOOP_BEGIN_
         _GET_HORIZONTAL_(self%id_c, C)
         C = max(C, 0.0_rk)
         _GET_(self%id_T, T)
         F = 0.0_rk
         do i = 1, self%nprey
            associate (q => self%prey(i))
            if (q%benthic) then
               _GET_HORIZONTAL_(q%idb_c, v)
               cc(i) = max(v, 0.0_rk) * q%cs
               if (q%has_n) then
                  _GET_HORIZONTAL_(q%idb_n, n)
                  cn(i) = max(n, 0.0_rk) * q%ns
               else
                  cn(i) = q%qn * cc(i)
               end if
               if (q%has_p) then
                  _GET_HORIZONTAL_(q%idb_p, p)
                  cp(i) = max(p, 0.0_rk) * q%ps
               else
                  cp(i) = q%qp * cc(i)
               end if
            else
               _GET_(q%id_c, v)
               cc(i) = max(v, 0.0_rk) * q%cs
               if (q%has_n) then
                  _GET_(q%id_n, n)
                  cn(i) = max(n, 0.0_rk) * q%ns
               else
                  cn(i) = q%qn * cc(i)
               end if
               if (q%has_p) then
                  _GET_(q%id_p, p)
                  cp(i) = max(p, 0.0_rk) * q%ps
               else
                  cp(i) = q%qp * cc(i)
               end if
            end if
            F = F + q%a * cc(i)
            end associate
         end do

         I_C = 0.0_rk; I_N = 0.0_rk; I_P = 0.0_rk
         do i = 1, self%nprey
            associate (q => self%prey(i))
            ! Eq. 1: G = sigma a C / (r + F); loss of prey = C_MB G (Eq. 13)
            k = min(C * q%sigma * q%a / (self%r_pel + F), self%kmax)
            I_C = I_C + k * cc(i)
            I_N = I_N + k * cn(i)
            I_P = I_P + k * cp(i)
            if (q%benthic) then
               _ADD_BOTTOM_SOURCE_(q%idb_c, -k * cc(i) / q%cs)
               if (q%has_n) then
                  _ADD_BOTTOM_SOURCE_(q%idb_n, -k * cn(i) / q%ns)
               end if
               if (q%has_p) then
                  _ADD_BOTTOM_SOURCE_(q%idb_p, -k * cp(i) / q%ps)
               end if
            else
               _GET_(q%id_c, v)
               _ADD_BOTTOM_FLUX_(q%id_c, -k * max(v, 0.0_rk))
               if (q%has_n) then
                  _GET_(q%id_n, v)
                  _ADD_BOTTOM_FLUX_(q%id_n, -k * max(v, 0.0_rk))
               end if
               if (q%has_p) then
                  _GET_(q%id_p, v)
                  _ADD_BOTTOM_FLUX_(q%id_p, -k * max(v, 0.0_rk))
               end if
               if (q%has_s) then
                  _GET_(q%id_s, v)
                  _ADD_BOTTOM_FLUX_(q%id_s, -k * max(v, 0.0_rk))
                  if (self%t%det_s%on) then
                     _ADD_BOTTOM_SOURCE_(self%t%det_s%idb, k * max(v, 0.0_rk) * q%ss * self%t%det_s%scale)
                  end if
               end if
               if (q%has_chl) then
                  _GET_(q%id_chl, v)
                  _ADD_BOTTOM_FLUX_(q%id_chl, -k * max(v, 0.0_rk))
               end if
            end if
            end associate
         end do

         call budget(self, C, I_C, I_N, I_P, T, b)
         _ADD_BOTTOM_SOURCE_(self%id_c, b%growth - b%mort - b%exc - b%fish)
         _ADD_BOTTOM_SOURCE_(self%id_landings, b%fish)

         ! Eq. 17: sediment receives unassimilated food and mortality
         call sed(self%t%det_c, b%det_c)
         call sed(self%t%det_n, b%det_n)
         call sed(self%t%det_p, b%det_p)
         ! Eq. 16, 18, 19: DOM, nutrients and oxygen in the bottom cell
         call flux(self%t%dom_c, b%dom_c)
         call flux(self%t%dom_n, b%dom_n)
         call flux(self%t%dom_p, b%dom_p)
         call flux(self%t%nh4, b%nh4)
         call flux(self%t%po4, b%po4)
         call flux(self%t%dic, b%dic)
         call flux(self%t%o2, b%o2)

         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_cons, I_C * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_growth, b%growth * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_exc, b%exc * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_mort, b%mort * sec_per_day)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_ww, C * 1e-3_rk / self%ww2c)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_food_tot, F)
         _SET_HORIZONTAL_DIAGNOSTIC_(self%id_T_exp, T)
      _BOTTOM_LOOP_END_

   contains

      subroutine sed(t, value)
         type (type_target), intent(in) :: t
         real(rk), intent(in) :: value
         if (t%on) then
            _ADD_BOTTOM_SOURCE_(t%idb, value * t%scale)
         end if
      end subroutine

      subroutine flux(t, value)
         type (type_target), intent(in) :: t
         real(rk), intent(in) :: value
         if (t%on) then
            _ADD_BOTTOM_FLUX_(t%id, value * t%scale)
         end if
      end subroutine
   end subroutine mb_do_bottom

end module e2e_models
