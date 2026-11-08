#include "fabm_driver.h"

!-----------------------------------------------------------------------
!BOP
!
! MODULE --- ECOSMO E2E fish model
!
! INTERFACE:
   module fabm_ecosmoe2e_fish
!
! DESCRIPTION:
!
!
! The ECOSMO E2E fish functional group model is based on Daewel et al.(GMD,2019)
! Authors: Vijith Vijayakumaran, Ute Daewel
! Address: Helmholtz Zentrum Hereon GmBH, Max-Planck-str. 1, Geesthacht, Germany 21502 |  https://www.hereon.de/
! Email: Vijith.Vijayakumaran@hereon.de; Ute.Daewel@hereon.de
! The modularisation of ECOSMO E2E model was funded by NECCTON project, Horizon Europe RIA under Grant Number 101081273
! Revision History: 26 March 2025
!
!
! USES
   use fabm_types
   use fabm_expressions

   
   implicit none

!  default: all is private.
   private
!
! !PUBLIC MEMBER FUNCTIONS:
   public type_ecosmoe2e_fish
!
! !PRIVATE DATA MEMBERS:
   real(rk), parameter :: sedy0 = 86400.0_rk ! 
   real(rk)            :: redf(20)=0.0_rk ! 
   real(rk)            :: BioC21=0.0_rk ! 
   real(rk)            :: BioC23=0.0_rk ! 
   real(rk)            :: BioC45=0.0_rk ! 
!
! !PUBLIC DERIVED TYPES:
   type,extends(type_base_model) :: type_ecosmoe2e_fish
!     Variable identifiers
      type (type_state_variable_id)         :: id_nh4, id_pho !
      type (type_state_variable_id)         :: id_det !, 
      type (type_state_variable_id)         :: id_dom, id_oxy ! 
      type (type_state_variable_id),allocatable         :: id_prey(:)!
      type (type_dependency_id)             :: id_temp ! 
      type (type_state_variable_id)         :: id_fish1 !
      type (type_bottom_state_variable_id)  :: id_mb1 ! 
! Variables for stoichiometry compensation
      type (type_state_variable_id)         :: id_detn,id_detp,id_dets
      type (type_state_variable_id)         :: id_domn,id_domp, id_doms ! 
      type (type_state_variable_id),allocatable         :: id_preyn(:),id_preyp(:),id_preys(:)!

!id diagnostics for fish calculation - integration
      type (type_horizontal_diagnostic_variable_id)    :: id_det_integr,id_fish_integr ! 
      type (type_horizontal_diagnostic_variable_id),allocatable    :: id_prey_integr(:)!
      type (type_horizontal_dependency_id)             :: id_detint,id_fishint  ! 
      type (type_horizontal_dependency_id),allocatable             :: id_preyint(:)!
      type (type_horizontal_diagnostic_variable_id)    :: id_dF1onDet, id_dF1onMB1 ! 
      type (type_horizontal_diagnostic_variable_id),allocatable    :: id_dF1onprey(:)!
      type (type_horizontal_dependency_id)             :: id_f1det, id_f1mb1 ! 
      type (type_horizontal_dependency_id),allocatable   :: id_f1prey(:)!
!     Model parameters
      real(rk) :: frr,BioC23,BioC45 ! 
! Ute Fish parameter declaration   
      real(rk) :: mF1,excF1,rF1,asefF1,tempcF1,rF1MB !
      real(rk) :: GrF1Det,GrF1MB1 ! 
      real(rk) :: prefF1Det ! 
      real(rk) :: prefF1MB1 ! 
      integer :: nprey
      real(rk), allocatable :: pref(:)
      real(rk), allocatable :: Gr(:)
      real(rk), allocatable :: scaleprey(:) ! To convert prey from the host LTL model's unit to ecosmo e2e unit
      real(rk) :: scalenh4,scalepho,scaleo2,scaledet,scaledom ! To convert components from the host LTL model's unit to ecosmo e2e unit
      character(len=10) :: compositiondet, compositiondom
      character(len=10), allocatable :: compositionprey(:)
      contains

!     Model procedures
      procedure :: initialize ! 
      procedure :: do !  
      procedure :: do_bottom ! 
   end type type_ecosmoe2e_fish
!EOP
!-----------------------------------------------------------------------

   contains

!-----------------------------------------------------------------------
!BOP
!
! SUBROUTINE: Initialise the ECOSMO model
!
! INTERFACE:
   subroutine initialize(self,configunit)
!
! INPUT PARAMETERS:
   class (type_ecosmoe2e_fish),intent(inout),target  :: self
   integer,                intent(in)            :: configunit
!
!
! LOCAL VARIABLES:
!
   integer :: i
   integer :: iprey
   character(len=8) :: strprey
   ! set Redfield ratios:
   redf(1) = 6.625_rk      !C_N 
   redf(2) = 106.0_rk      !C_P 
   redf(3) = 6.625_rk      !C_SiO  
   redf(4) = 16.0_rk       !N_P  
   redf(5) = 1.0_rk        !N_SiO  
   redf(6) = 12.01_rk      !C_Cmg 
   redf(7) = 44.6608009_rk !O2mm_ml  
   redf(8) = 14.007_rk     !N_Nmg  
   redf(9) = 30.97_rk      !P_Pmg  
   redf(10) = 28.09_rk     !Si_Simg 
   do i=1,10
     redf(i+10) = 1._rk/redf(i) ! 
   end do


!EOP
!-----------------------------------------------------------------------
!BOC

   call self%get_parameter(self%frr, 'frr', '-', 'fraction of dissolved from det.', default=0.4_rk) ! 
   call self%get_parameter( self%BioC23, 'sinkDet',     'm/day',      'Detritus sinking rate',           default=5.00_rk,   scale_factor=1.0_rk/sedy0) !
   call self%get_parameter( self%BioC45,  'sinkDia',    'm/day',      'Diatom sinking rate',             default=0.0_rk,   scale_factor=1.0_rk/sedy0) ! 

   !parameter for functional group fish 
   call self%get_parameter( self%mF1,      'mF1',       '1/day', 'fish1 mortality rate',     default=0.001_rk, scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%excF1,    'excF1',     '1/day', 'fish1 excretion rate',     default=0.002_rk, scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%rF1,      'rF1',       'mmolN/m**3', 'fish1 grazing half saturation',    default=0.70_rk,  scale_factor=redf(1)*redf(6))
   call self%get_parameter( self%rF1MB,    'rF1MB',     'mmolN/m**3', 'fish1 grazing on MB half saturation',   default=0.90_rk,  scale_factor=redf(1)*redf(6))
   call self%get_parameter( self%tempcF1,  'tempcF1',   '1/day',      'fish1 temperature control excr.',   default=0.5_rk)
   call self%get_parameter( self%asefF1,   'asefF1',    '-',      'fish1 assimilation efficiency',           default=0.7_rk)
   call self%get_parameter( self%GrF1Det,  'GrF1Det',   '1/day', 'Grazingrate fish1 on Detritus',          default=0.05_rk,   scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%GrF1MB1,  'GrF1MB1',   '1/day', 'Grazingrate fish1 on macrobenthos1',     default=0.01_rk,   scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%prefF1Det,'prefF1Det', '-',          'Grazing preference fish1 on Det',   default=0.05_rk)
   call self%get_parameter( self%prefF1MB1,'prefF1MB1', '-',          'Grazing preference fish1 on MB1',   default=0.25_rk)
   call self%get_parameter(self%scalenh4, 'scalenh4', '-', 'scaling for unit conversion of nh4', default=1.0_rk)
   call self%get_parameter(self%scalepho, 'scalepho', '-', 'scaling for unit conversion of pho', default=1.0_rk)
   call self%get_parameter(self%scaleo2, 'scaleo2', '-', 'scaling for unit conversion of o2', default=1.0_rk)
   call self%get_parameter(self%scaledet, 'scaledet', '-', 'scaling for unit conversion of det', default=1.0_rk)
   call self%get_parameter(self%scaledom, 'scaledom', '-', 'scaling for unit conversion of dom', default=1.0_rk)
   call self%get_parameter(self%nprey, 'nprey', '', 'number of prey', default=2)

   !composition
   call self%get_parameter(self%compositiondet, 'compositiondet', '', 'elemental composition of det', default='c')
   call self%get_parameter(self%compositiondom, 'compositiondom', '', 'elemental composition of dom', default='c')

   allocate(self%pref(self%nprey))
   allocate(self%Gr(self%nprey))
   allocate(self%id_prey(self%nprey))
   allocate(self%id_prey_integr(self%nprey))
   allocate(self%id_dF1onprey(self%nprey))
   allocate(self%id_preyint(self%nprey))
   allocate(self%id_f1prey(self%nprey))
   allocate(self%scaleprey(self%nprey))
   allocate(self%compositionprey(self%nprey))
   allocate(self%id_preyn(self%nprey))
   allocate(self%id_preyp(self%nprey))
   allocate(self%id_preys(self%nprey))
   do iprey=1,self%nprey
      write (strprey,'(i0)') iprey
      call self%get_parameter(self%Gr(iprey), 'Gr'//trim(strprey), '1/day', 'Grazingrate fish on prey '//trim(strprey), default=0.01_rk, scale_factor=1.0_rk/sedy0)
      call self%get_parameter(self%pref(iprey), 'pref'//trim(strprey), '-', 'Grazing preference for fish on prey '//trim(strprey), default=0.25_rk)
      call self%register_state_dependency(self%id_prey(iprey),'prey'//trim(strprey), 'mgC/m3', 'prey '//trim(strprey))
      call self%register_diagnostic_variable(self%id_prey_integr(iprey),'preyint'//trim(strprey),'mgC/m**2', &
         'depthintegrated prey'//trim(strprey), source=source_do_bottom) ! 
      call self%register_diagnostic_variable(self%id_dF1onprey(iprey),'F1prey'//trim(strprey),'mgC/m**2/s', &
         'Fish feeding on prey'//trim(strprey), source=source_do_bottom) ! 
      call self%register_dependency(self%id_preyint(iprey),vertical_integral(self%id_prey(iprey))) ! 
      call self%register_dependency(self%id_f1prey(iprey),'F1prey'//trim(strprey),'mgC/m**2/s', 'Fish feeding on prey'//trim(strprey)) ! 
      call self%get_parameter(self%scaleprey(iprey), 'scaleprey'//trim(strprey), '-', 'scaling for unit conversion of prey '//trim(strprey), default=1.0_rk)
      call self%get_parameter(self%compositionprey(iprey), 'compositionprey'//trim(strprey), '', 'elemental composition of prey '//trim(strprey), default='c')
      if (index(self%compositionprey(iprey),'n')/=0) call self%register_state_dependency(self%id_preyn(iprey),'preyn'//trim(strprey), 'mmol N/m3', 'preyn '//trim(strprey))
      if (index(self%compositionprey(iprey),'p')/=0) call self%register_state_dependency(self%id_preyp(iprey),'preyp'//trim(strprey), 'mmol P/m3', 'preyp '//trim(strprey))
      if (index(self%compositionprey(iprey),'s')/=0) call self%register_state_dependency(self%id_preys(iprey),'preys'//trim(strprey), 'mmol Si/m3', 'preys '//trim(strprey))
   end do
   ! Register state dependencies
   call self%register_state_dependency(self%id_nh4,      'nh4',     'mgC/m3',    'ammonium')
   call self%register_state_dependency(self%id_pho,      'pho',     'mgC/m3',    'phosphate')!                
   call self%register_state_dependency(self%id_oxy,      'oxy',     'mmolO2/m3', 'oxygen')! 
   call self%register_state_dependency(self%id_det,      'det',     'mgC/m3',    'detritus')!
   call self%register_state_dependency(self%id_dom,      'dom',     'mgC/m3',    'labile dissolved om')!
   call self%register_state_dependency(self%id_mb1,     'mb',    'mgC/m2',    'macrobenthos')!      
   if (index(self%compositiondet,'n')/=0) call self%register_state_dependency( self%id_detn,      'detn',     'mmol N/m3',   'detritus N')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   if (index(self%compositiondet,'p')/=0) call self%register_state_dependency( self%id_detp,      'detp',     'mmol P/m3',   'detritus P')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   if (index(self%compositiondet,'s')/=0) call self%register_state_dependency( self%id_dets,      'dets',     'mmol Si/m3',  'detritus Si')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   if (index(self%compositiondom,'n')/=0) call self%register_state_dependency( self%id_domn,      'domn',     'mmol N/m3',   'labile dissolved om N')!      minimum=0.0_rk , &
   if (index(self%compositiondom,'p')/=0) call self%register_state_dependency( self%id_domp,      'domp',     'mmol P/m3',   'labile dissolved om P')!      minimum=0.0_rk , &
   if (index(self%compositiondom,'s')/=0) call self%register_state_dependency( self%id_doms,      'doms',     'mmol Si/m3',  'labile dissolved om Si')!      minimum=0.0_rk , &
   ! Register state variables

   ! Register state variables

   call self%register_state_variable( self%id_fish1,     'c',    'mgC/m3',    'fish functional group biomass',    minimum=0.0_rk,    &      
                                      initial_value=1e-6_rk*redf(1)*redf(6) ) ! 
   call self%register_diagnostic_variable(self%id_det_integr,'Detint','mgC/m**2', &
         'depthintegrated detritus', source=source_do_bottom) ! 
   call self%register_diagnostic_variable(self%id_fish_integr,'Fishint','mgC/m**2', &
         'depthintegrated fish1', source=source_do_bottom) ! 
   call self%register_diagnostic_variable(self%id_dF1onDet,'F1De','mgC/m**2/s', &
         'Fish feeding on Detritus', source=source_do_bottom) ! 
   call self%register_diagnostic_variable(self%id_dF1onMB1,'F1MB1','mgC/m**2/s', &
         'Fish feeding on Macrobenthos', source=source_do_bottom) ! 

   ! Register dependencies
   call self%register_dependency(self%id_temp,standard_variables%temperature)
   call self%register_dependency(self%id_detint,vertical_integral(self%id_det)) ! 
   call self%register_dependency(self%id_fishint,vertical_integral(self%id_fish1))  ! 
   call self%register_dependency(self%id_f1det,'F1De','mgC/m**2/s', 'Fish feeding on Detritus') ! 
   call self%register_dependency(self%id_f1mb1,'F1MB1','mgC/m**2/s', 'Fish feeding on Macrobenthos') ! 

   return

end subroutine initialize
!EOC

!-----------------------------------------------------------------------
!BOP
!
! SUBROUTINE: Pelagic fields
!
! !INTERFACE:
   subroutine do(self,_ARGUMENTS_DO_) ! 
!
!
! INPUT PARAMETERS:
   class (type_ecosmoe2e_fish),intent(in) :: self
   _DECLARE_ARGUMENTS_DO_
!
!  Original author(s): Richard Hofmeister
!
! LOCAL VARIABLES:
   real(rk) :: nh4,pho,oxy
   real(rk) :: det,dom
   real(rk),allocatable :: prey(:)
   real(rk) :: temp
   real(rk) :: rhs,rhs1
! local variables for fish    
   real(rk) :: deti,fishi,F1onDet, F1onMB1, Fish_prod,ttemp
   real(rk),allocatable :: preyi(:),F1onprey(:)!
   real(rk) :: fish1 
   integer :: iprey
   real(rk) :: expterm

! Prey composition checks:
logical, dimension(:), allocatable :: hasNprey, hasPprey, hasSprey

! Similarly for DET composition:
logical :: hasNdet, hasPdet, hasSdet
!EOP
!-----------------------------------------------------------------------
!BOC
   ! Enter spatial loops (if any)

   allocate(prey(self%nprey))
   allocate(preyi(self%nprey))
   allocate(F1onprey(self%nprey))
   allocate(hasNprey(self%nprey))
   allocate(hasPprey(self%nprey))
   allocate(hasSprey(self%nprey))
   _LOOP_BEGIN_
   do iprey=1,self%nprey
    _GET_(self%id_prey(iprey),prey(iprey))
    _GET_HORIZONTAL_(self%id_preyint(iprey),preyi(iprey))
    _GET_HORIZONTAL_(self%id_f1prey(iprey),F1onprey(iprey))
    prey(iprey)=prey(iprey)*self%scaleprey(iprey) !convert prey conc. into E2E unit
    preyi(iprey)=preyi(iprey)*self%scaleprey(iprey) !convert prey conc. into E2E unit
    F1onprey(iprey)=F1onprey(iprey)!iself%scaleprey(iprey) !convert prey conc. into E2E unit
    hasNprey(iprey) = (index(self%compositionprey(iprey), 'n') /= 0)
    hasPprey(iprey) = (index(self%compositionprey(iprey), 'p') /= 0)
    hasSprey(iprey) = (index(self%compositionprey(iprey), 's') /= 0)
   enddo 
    ! DET composition checks:
    hasNdet = (index(self%compositiondet,'n') /= 0)
    hasPdet = (index(self%compositiondet,'p') /= 0)
    hasSdet = (index(self%compositiondet,'s') /= 0)
   _GET_(self%id_temp,temp)
   _GET_(self%id_nh4,nh4)
   _GET_(self%id_pho,pho)
   _GET_(self%id_det,det)
   _GET_(self%id_oxy,oxy)
    ! get horizontal variables for fish estimates
   _GET_HORIZONTAL_(self%id_detint,deti)
   _GET_HORIZONTAL_(self%id_fishint,fishi)
   _GET_HORIZONTAL_(self%id_f1det,F1onDet)
   _GET_HORIZONTAL_(self%id_f1mb1,F1onMB1)
   _GET_(self%id_fish1,fish1)
   det=det*self%scaledet
   deti=deti*self%scaledet
        ttemp=temp/((temp+273.15)*273.15)
        expterm=exp((self%tempcF1/(8.6173324*10.**(-5.)))*ttemp)

! prey
     do iprey=1,self%nprey
      rhs=-1.0_rk*(F1onprey(iprey)*prey(iprey)/preyi(iprey)*fishi)  !fish1 predation!fishi is integrated fish1 
      _ADD_SOURCE_(self%id_prey(iprey), rhs/self%scaleprey(iprey)) ! 
      if (hasNprey(iprey)) _ADD_SOURCE_(self%id_preyn(iprey),rhs*redf(4)/(redf(2)*redf(6)*self%scaleprey(iprey)))     ! 
      if (hasPprey(iprey)) _ADD_SOURCE_(self%id_preyp(iprey),rhs/(redf(2)*redf(6)*self%scaleprey(iprey)))     ! 
      if (hasSprey(iprey)) _ADD_SOURCE_(self%id_preys(iprey),rhs*redf(4)/(redf(2)*redf(6)*self%scaleprey(iprey)))     ! 
     enddo
   
   Fish_prod=0.
   do iprey=1,self%nprey
    Fish_prod=Fish_prod+(F1onprey(iprey)*prey(iprey)/preyi(iprey))
   enddo
   rhs1=Fish_prod
   Fish_prod=self%asefF1*(Fish_prod+(F1onDet*det/deti))*fishi   
   rhs=Fish_prod-(self%mF1+self%excF1*expterm)*fish1 ! & 
   _ADD_SOURCE_(self%id_fish1, rhs) ! 

   !  rhs=0.0_rk
   !do iprey=1,self%nprey
   !   rhs=rhs+(F1onprey(iprey)*prey(iprey)/preyi(iprey))
   !enddo
     rhs=rhs1
     rhs = (1.0_rk-self%frr)*((1.-self%asefF1)*(rhs+F1onDet*det/deti)*fishi  &      !
              + self%mF1*fish1) ! 
   _ADD_SOURCE_(self%id_det, rhs/self%scaledet) ! 
   if (hasNdet) _ADD_SOURCE_(self%id_detn,rhs*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  
   if (hasPdet) _ADD_SOURCE_(self%id_detp,rhs/(redf(2)*redf(6)*self%scaledet))     !  
   if (hasSdet) _ADD_SOURCE_(self%id_dets,rhs*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  
     rhs = - F1onDet*det/deti*fishi !

   _ADD_SOURCE_(self%id_det, rhs/self%scaledet) ! 
   if (hasNdet) _ADD_SOURCE_(self%id_detn,rhs*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  
   if (hasPdet) _ADD_SOURCE_(self%id_detp,rhs/(redf(2)*redf(6)*self%scaledet))     !  
   if (hasSdet) _ADD_SOURCE_(self%id_dets,rhs*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  
    rhs = self%excF1*expterm*fish1 !&
 
   _ADD_SOURCE_(self%id_nh4, rhs/self%scalenh4) ! 


    !rhs = self%excF1*expterm*fish1 !&
   _ADD_SOURCE_(self%id_pho, rhs/self%scalepho) ! 


     !rhs = (self%excF1*expterm*fish1)*redf(11)*redf(16) !! 
     rhs = rhs*redf(11)*redf(16) !! 
   _ADD_SOURCE_(self%id_oxy, rhs/self%scaleo2) ! 

   _LOOP_END_

   end subroutine do
!EOC

!-----------------------------------------------------------------------
!
! IROUTINE: Bottom fluxes for the ecosmo model
!
! INTERFACE:

   subroutine do_bottom(self,_ARGUMENTS_DO_BOTTOM_) ! 
   class (type_ecosmoe2e_fish),intent(in) :: self
   _DECLARE_ARGUMENTS_DO_BOTTOM_
!
! !LOCAL VARIABLES:
   real(rk) :: oxy, det!
   real(rk) :: rhs !
   real(rk) :: mb1 ! 
   real(rk) :: dom 
   real(rk),allocatable :: prey(:)! 
!   real(rk) :: ttemp 
   real(rk) :: rcMB,MBflux
! add fish local variables integrated values
   real(rk) :: deti,fishi,fishi1
   real(rk),allocatable :: preyi(:)!
   real(rk) :: Ff1,F1onDet,F1onMB1
   real(rk),allocatable :: F1onprey(:)!
   integer :: iprey

! DET composition:
   logical :: hasNdet, hasPdet, hasSdet
   logical :: hasNdom, hasPdom, hasSdom
!EOP
!-----------------------------------------------------------------------
!BOC

   allocate(prey(self%nprey))
   allocate(preyi(self%nprey))
   allocate(F1onprey(self%nprey))
   _HORIZONTAL_LOOP_BEGIN_
!   _GET_(self%id_temp,temp)
   _GET_(self%id_oxy,oxy)
   _GET_(self%id_det,det)
    do iprey=1,self%nprey
     _GET_(self%id_prey(iprey),prey(iprey))
     _GET_HORIZONTAL_(self%id_preyint(iprey),preyi(iprey)) !
     prey(iprey)=prey(iprey)*self%scaleprey(iprey) !convert prey conc. into E2E unit
     preyi(iprey)=preyi(iprey)*self%scaleprey(iprey) !convert prey conc. into E2E unit
    enddo
    ! DET composition checks:
    hasNdet = (index(self%compositiondet,'n') /= 0)
    hasPdet = (index(self%compositiondet,'p') /= 0)
    hasSdet = (index(self%compositiondet,'s') /= 0)
    ! DET composition checks:
    hasNdom = (index(self%compositiondom,'n') /= 0)
    hasPdom = (index(self%compositiondom,'p') /= 0)
    hasSdom = (index(self%compositiondom,'s') /= 0)


   _GET_(self%id_dom,dom)
   _GET_HORIZONTAL_(self%id_mb1,mb1) ! 
   _GET_HORIZONTAL_(self%id_detint,deti)
   _GET_HORIZONTAL_(self%id_fishint,fishi)
   deti=deti*self%scaledet !Convertion to E2E unit
    !grazing fish
    Ff1=0.0_rk
    do iprey=1,self%nprey
    Ff1=Ff1+self%pref(iprey)*preyi(iprey)!
    enddo
    Ff1=Ff1+self%prefF1Det*deti+self%prefF1MB1*mb1 ! 
!
    do iprey=1,self%nprey
     F1onprey(iprey)=0.
    enddo
     F1onDet=0.
     F1onMB1=0.
    if(oxy .gt. 0.0)then !hypoxia
      do iprey=1,self%nprey
       if(preyi(iprey).ge.0.) F1onprey(iprey)=self%pref(iprey)*self%Gr(iprey)*preyi(iprey)/(self%rF1+Ff1)! 
      enddo
       if(deti.ge.0.) F1onDet =self%prefF1Det*self%GrF1Det*deti/(self%rF1+Ff1) !
       if(mb1.ge.0.)F1onMB1=self%prefF1MB1*self%GrF1MB1*mb1/(self%rF1MB+Ff1) ! 
     endif


        _ADD_BOTTOM_FLUX_(self%id_fish1,+self%asefF1*F1onMB1*fishi) !
        rcMB=-F1onMB1*fishi ! &
         _ADD_BOTTOM_SOURCE_(self%id_mb1,rcMB)     !  

         MBflux=((1.-self%frr)*((1.-self%asefF1)*F1onMB1*fishi))! & !
          _ADD_BOTTOM_FLUX_(self%id_det,MBflux/self%scaledet) ! 
        if (hasNdet) _ADD_BOTTOM_FLUX_(self%id_detn,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  
        if (hasPdet) _ADD_BOTTOM_FLUX_(self%id_detp,MBflux/(redf(2)*redf(6)*self%scaledet))     !  
        if (hasSdet) _ADD_BOTTOM_FLUX_(self%id_dets,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  

         MBflux=(self%frr)*((1.-self%asefF1)*F1onMB1*fishi)!  &  !    
         _ADD_BOTTOM_FLUX_(self%id_dom,MBflux/self%scaledom)     ! 
        if (hasNdom) _ADD_BOTTOM_FLUX_(self%id_domn,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledom))     ! 
        if (hasPdom) _ADD_BOTTOM_FLUX_(self%id_domp,MBflux/(redf(2)*redf(6)*self%scaledom))     ! 
        if (hasSdom) _ADD_BOTTOM_FLUX_(self%id_doms,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledom))     ! 
        fishi1=fishi    ! 
 ! Diagnostics for fish
    do iprey=1,self%nprey
     _SET_HORIZONTAL_DIAGNOSTIC_(self%id_prey_integr(iprey),preyi(iprey)) ! 
     _SET_HORIZONTAL_DIAGNOSTIC_(self%id_dF1onprey(iprey),F1onprey(iprey))!
    enddo
   _SET_HORIZONTAL_DIAGNOSTIC_(self%id_det_integr,deti) !
   _SET_HORIZONTAL_DIAGNOSTIC_(self%id_fish_integr,fishi1) !
! Diagnostics for dependency
   _SET_HORIZONTAL_DIAGNOSTIC_(self%id_dF1onDet,F1onDet)!
   _SET_HORIZONTAL_DIAGNOSTIC_(self%id_dF1onMB1,F1onMB1)!
   _HORIZONTAL_LOOP_END_

   end subroutine do_bottom
!EOC

   end module fabm_ecosmoe2e_fish


!-----------------------------------------------------------------------
! Copyright by the E2E-team under the GNU Public License - www.gnu.org
!----------------------------------------------------------------------
