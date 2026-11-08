#include "fabm_driver.h"

!-----------------------------------------------------------------------
!BOP
!
! MODULE --- ECOSMO E2E macrobenthos model
!
! !INTERFACE:
   module fabm_ecosmoe2e_mb
!
! DESCRIPTION:
!
! The ECOSMO E2E macrobenthos functional group model is based on Daewel et al.(GMD,2019)
! Authors: Vijith Vijayakumaran, Ute Daewel
! Address: Helmholtz Zentrum Hereon GmBH, Max-Planck-str. 1, Geesthacht, Germany 21502 |  https://www.hereon.de/
! Email: Vijith.Vijayakumaran@hereon.de; Ute.Daewel@hereon.de
! The modularisation of ECOSMO E2E model was funded by NECCTON project, Horizon Europe RIA under Grant Number 101081273
! Revision History: 26 March 2025

! !USES:
   use fabm_types
   use fabm_expressions

   
   implicit none

!  default: all is private.
   private
!
! !PUBLIC MEMBER FUNCTIONS:
   public type_ecosmoe2e_mb
!
! !PRIVATE DATA MEMBERS:
   real(rk), parameter :: sedy0 = 86400.0_rk ! 
   real(rk)            :: redf(20)=0.0_rk ! 
   real(rk)            :: BioC21=0.0_rk ! 
   real(rk)            :: BioC23=0.0_rk ! 
   real(rk)            :: BioC45=0.0_rk ! 
!
! PUBLIC DERIVED TYPES:
   type,extends(type_base_model) :: type_ecosmoe2e_mb
!     Variable identifiers
      type (type_state_variable_id)         :: id_nh4, id_pho !
      type (type_state_variable_id)         :: id_det! 
      type (type_state_variable_id)         :: id_dom, id_oxy ! 
      type (type_state_variable_id),allocatable         :: id_prey(:)!
      type (type_bottom_state_variable_id)  :: id_sed1 ! 
      type (type_dependency_id)             :: id_temp ! 
! Variables for stoichiometry compensation
      type (type_state_variable_id)         :: id_detn,id_detp,id_dets
      type (type_state_variable_id)         :: id_domn,id_domp, id_doms ! 
      type (type_state_variable_id),allocatable         :: id_preyn(:),id_preyp(:),id_preys(:)!
      type (type_bottom_state_variable_id)  :: id_sedn,id_sedp,id_seds ! 
!htl variable
      type (type_bottom_state_variable_id)  :: id_mb1 ! 
!Diagnostic variables 
      type (type_bottom_diagnostic_variable_id)    :: id_dMBonDet, id_dMBonDom, id_dMBonSed !
      type (type_bottom_diagnostic_variable_id),allocatable    :: id_dMBonprey(:) !
      type (type_bottom_dependency_id)             :: id_mbdet, id_mbdom, id_mbsed
      type (type_bottom_dependency_id),allocatable             :: id_mbprey(:) !

!     Model parameters
      real(rk) :: BioC21 ! 
      real(rk) :: frr,BioC23,BioC45 ! 
!  MB parameter declaration   
      real(rk) :: mMB1,excMB1,rMB1,tempcMB1 ! 
      real(rk) :: GrMB1Det,GrMB1Sed  ! 
      real(rk) :: prefMB1Sed ! 
      real(rk) :: prefMB1Det ! 
      real(rk) :: prefMB1Dom ! 
      integer :: nprey
      real(rk), allocatable :: pref(:)
      real(rk), allocatable :: Gr(:)
      real(rk), allocatable :: scaleprey(:) ! To convert prey from the host LTL model's unit to ecosmo e2e unit
      real(rk) :: scalenh4,scalepho,scaleo2,scaledet,scaledom,scalesed ! To convert components from the host LTL model's unit to ecosmo e2e unit
      character(len=10) :: compositiondet, compositiondom, compositionsed
      character(len=10), allocatable :: compositionprey(:)
      contains

!     Model procedures
      procedure :: initialize ! 
      procedure :: do_bottom ! 
   end type type_ecosmoe2e_mb
!EOP
!-----------------------------------------------------------------------

   contains

!-----------------------------------------------------------------------
!BOP
!
! SUBROUTINE: Initialise the ECOSMO model
!
! !INTERFACE:
   subroutine initialize(self,configunit)
!
! !INPUT PARAMETERS:
   class (type_ecosmoe2e_mb),intent(inout),target  :: self
   integer,                intent(in)            :: configunit
!
!
! LOCAL VARIABLES:
!
   integer :: i
   integer :: iprey
   character(len=8) :: strprey
   !Redfield ratios:
   redf(1) = 6.625_rk      !C_N 
   redf(2) = 106.0_rk      !C_P 
   redf(3) = 6.625_rk      !C_SiO  
   redf(4) = 16.0_rk       !N_P  
   redf(5) = 1.0_rk        !N_SiO  
   redf(6) = 12.01_rk      !C_Cmg
   redf(7) = 44.6608009_rk !O2mm_ml  
   redf(8) = 14.007_rk     !N_Nmg  the inverse of redf(8) is used in sediment detritus
   redf(9) = 30.97_rk      !P_Pmg  
   redf(10) = 28.09_rk     !Si_Simg 
   do i=1,10
     redf(i+10) = 1._rk/redf(i) 
   end do


!EOP
!-----------------------------------------------------------------------
!BOC


   call self%get_parameter(self%frr, 'frr', '-', 'fraction of dissolved from det.', default=0.4_rk) ! 
   call self%get_parameter( self%BioC21, 'gammaZd',     '1',          'Zl & Zs assim. eff. on det',      default=0.75_rk) !   
   call self%get_parameter( self%BioC23, 'sinkDet',     'm/day',      'Detritus sinking rate',           default=5.00_rk,   scale_factor=1.0_rk/sedy0) ! 
   call self%get_parameter( self%BioC45,  'sinkDia',    'm/day',      'Diatom sinking rate',             default=0.0_rk,   scale_factor=1.0_rk/sedy0) ! 

   ! Macrobenthos parameter settings  
   call self%get_parameter( self%mMB1,      'mMB1',       '1/day', 'Macrobenthos mortality rate',     default=0.001_rk,   scale_factor=1.0_rk/sedy0) ! 
   call self%get_parameter( self%excMB1,    'excMB1',     '1/day', 'Macrobenthos excretion rate',     default=0.025_rk, scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%rMB1,      'rMB1',       'mmolN/m**3',  'MB grazing half saturation',      default=0.50_rk,  scale_factor=redf(1)*redf(6))
   call self%get_parameter( self%GrMB1Det,  'GrMB1Det',   '1/day', 'Grazingrate MB1 on Detritus',     default=0.1_rk,   scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%GrMB1Sed,  'GrMB1Sed',   '1/day', 'Grazingrate MB1 on Sediment',     default=0.1_rk,   scale_factor=1.0_rk/sedy0)
   call self%get_parameter( self%tempcMB1,  'tempcMB1',   '1/day',      'MB1 temperature control excr.',   default=0._rk)
   call self%get_parameter( self%prefMB1Det,'prefMB1Det', '-',          'Grazing preference MB1 on Det',   default=0.10_rk)
   call self%get_parameter( self%prefMB1Sed,'prefMB1Sed', '-',          'Grazing preference MB1 on Sed',   default=0.10_rk)
   call self%get_parameter( self%prefMB1Dom,'prefMB1Dom', '-',          'Grazing preference MB1 on Dom',   default=0.10_rk)
   call self%get_parameter(self%scalenh4, 'scalenh4', '-', 'scaling for unit conversion of nh4', default=1.0_rk)
   call self%get_parameter(self%scalepho, 'scalepho', '-', 'scaling for unit conversion of pho', default=1.0_rk)
   call self%get_parameter(self%scaleo2, 'scaleo2', '-', 'scaling for unit conversion of o2', default=1.0_rk)
   call self%get_parameter(self%scaledet, 'scaledet', '-', 'scaling for unit conversion of det', default=1.0_rk)
   call self%get_parameter(self%scalesed, 'scalesed', '-', 'scaling for unit conversion of sed', default=1.0_rk)
   call self%get_parameter(self%scaledom, 'scaledom', '-', 'scaling for unit conversion of dom', default=1.0_rk)

   !composition
   call self%get_parameter(self%compositiondet, 'compositiondet', '', 'elemental composition of det', default='c')
   call self%get_parameter(self%compositiondom, 'compositiondom', '', 'elemental composition of dom', default='c')
   call self%get_parameter(self%compositionsed, 'compositionsed', '', 'elemental composition of sed', default='c')

   call self%get_parameter(self%nprey, 'nprey', '', 'number of prey', default=2)
   allocate(self%pref(self%nprey))
   allocate(self%Gr(self%nprey))
   allocate(self%scaleprey(self%nprey))
   allocate(self%id_prey(self%nprey))
   allocate(self%id_dMBonprey(self%nprey))
   allocate(self%id_mbprey(self%nprey))
   allocate(self%compositionprey(self%nprey))
   allocate(self%id_preyn(self%nprey))
   allocate(self%id_preyp(self%nprey))
   allocate(self%id_preys(self%nprey))
   do iprey=1,self%nprey
      write (strprey,'(i0)') iprey
      call self%get_parameter(self%Gr(iprey), 'Gr'//trim(strprey), '1/day', 'Grazingrate fish on prey '//trim(strprey), default=0.01_rk, scale_factor=1.0_rk/sedy0)
      call self%get_parameter(self%pref(iprey), 'pref'//trim(strprey), '-', 'Grazing preference for fish on prey '//trim(strprey), default=0.25_rk)
      call self%get_parameter(self%scaleprey(iprey), 'scaleprey'//trim(strprey), '-', 'scaling for unit conversion of prey '//trim(strprey), default=1.0_rk)
      call self%get_parameter(self%compositionprey(iprey), 'compositionprey'//trim(strprey), '', 'elemental composition of prey '//trim(strprey), default='c')
      call self%register_state_dependency(self%id_prey(iprey),'prey'//trim(strprey), 'mgC/m3', 'prey '//trim(strprey))

      call self%register_diagnostic_variable(self%id_dMBonprey(iprey),'MBprey'//trim(strprey),'mgC/m**2/s', &
         'MB feeding on prey'//trim(strprey), source=source_do_bottom) !
      call self%register_dependency(self%id_mbprey(iprey),'MBprey'//trim(strprey),'mgC/m**2/s', 'MB feeding on prey'//trim(strprey)) !
!      write(*,*)self%compositionprey(iprey)
      if (index(self%compositionprey(iprey),'n')/=0) call self%register_state_dependency(self%id_preyn(iprey),'preyn'//trim(strprey), 'mmol N/m3', 'preyn '//trim(strprey))
      if (index(self%compositionprey(iprey),'p')/=0) call self%register_state_dependency(self%id_preyp(iprey),'preyp'//trim(strprey), 'mmol P/m3', 'preyp '//trim(strprey))
      if (index(self%compositionprey(iprey),'s')/=0) call self%register_state_dependency(self%id_preys(iprey),'preys'//trim(strprey), 'mmol Si/m3', 'preys '//trim(strprey))
   enddo
      ! Register dependencies
   call self%register_dependency(self%id_temp,standard_variables%temperature)
   ! Register state dependencies
   call self%register_state_dependency( self%id_nh4,      'nh4',     'mgC/m3',    'ammonium')!                 minimum=0.0_rk,        vertical_movement=0.0_rk,  &
   call self%register_state_dependency( self%id_pho,      'pho',     'mgC/m3',    'phosphate')!                minimum=0.0_rk,        vertical_movement=0.0_rk,  &
   call self%register_state_dependency( self%id_oxy,      'oxy',     'mmolO2/m3', 'oxygen')!                   minimum=0.0_rk,   vertical_movement=0.0_rk,  &
   call self%register_state_dependency( self%id_det,      'det',     'mgC/m3',    'detritus')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   call self%register_state_dependency( self%id_dom,      'dom',     'mgC/m3',    'labile dissolved om')!      minimum=0.0_rk , &
   call self%register_state_dependency( self%id_sed1,     'sed1',    'mgC/m2',    'sediment detritus')!        minimum=0.0_rk , &

   if (index(self%compositiondet,'n')/=0) call self%register_state_dependency( self%id_detn,      'detn',     'mmol N/m3',   'detritus N')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   if (index(self%compositiondet,'p')/=0) call self%register_state_dependency( self%id_detp,      'detp',     'mmol P/m3',   'detritus P')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   if (index(self%compositiondet,'s')/=0) call self%register_state_dependency( self%id_dets,      'dets',     'mmol Si/m3',  'detritus Si')!                 minimum=0.0_rk,        vertical_movement=-self%BioC23 , &
   if (index(self%compositiondom,'n')/=0) call self%register_state_dependency( self%id_domn,      'domn',     'mmol N/m3',   'labile dissolved om N')!      minimum=0.0_rk , &
   if (index(self%compositiondom,'p')/=0) call self%register_state_dependency( self%id_domp,      'domp',     'mmol P/m3',   'labile dissolved om P')!      minimum=0.0_rk , &
   if (index(self%compositiondom,'s')/=0) call self%register_state_dependency( self%id_doms,      'doms',     'mmol Si/m3',  'labile dissolved om Si')!      minimum=0.0_rk , &
   if (index(self%compositionsed,'n')/=0) call self%register_state_dependency( self%id_sedn,     'sedn',    'mmol N/m2',    'sediment detritus N')!        minimum=0.0_rk , &
   if (index(self%compositionsed,'p')/=0) call self%register_state_dependency( self%id_sedp,     'sedp',    'mmol P/m2',    'sediment detritus P')!        minimum=0.0_rk , &
   if (index(self%compositionsed,'s')/=0) call self%register_state_dependency( self%id_seds,     'seds',    'mmol Si/m2',    'sediment detritus Si')!        minimum=0.0_rk , &
   ! Register state variables
   call self%register_state_variable( self%id_mb1,     'c',    'mgC/m2',    'macrobenthos',    minimum=0.0_rk,    &      
                                      initial_value=1e-6_rk*redf(1)*redf(6) ) ! 
! Register Diagnostic variable Vijith
   call self%register_diagnostic_variable(self%id_dMBonDet,'MBDe','mgC/m**2/s', &
         'MB feeding on Detritus', source=source_do_bottom) !
   call self%register_dependency(self%id_mbdet,'MBDe','mgC/m**2/s', 'MB feeding on Detritus') !
   call self%register_diagnostic_variable(self%id_dMBonDom,'MBDom','mgC/m**2/s', &
           'MB feeding on Dom', source=source_do_bottom) !
   call self%register_dependency(self%id_mbdom,'MBDom','mgC/m**2/s', 'MB feeding on Dom') !
   call self%register_diagnostic_variable(self%id_dMBonSed,'MBSe','mgC/m**2/s', &
           'MB feeding on Sed', source=source_do_bottom) !
   call self%register_dependency(self%id_mbsed,'MBSe','mgC/m**2/s', 'MB feeding on Sed') !
   return

end subroutine initialize
!EOC

!-----------------------------------------------------------------------
!BOP
!

!-----------------------------------------------------------------------
!
! SUBROUTINE: Bottom fluxes for the ecosmo e2e model
!
! !INTERFACE:

   subroutine do_bottom(self,_ARGUMENTS_DO_BOTTOM_) ! 
   class (type_ecosmoe2e_mb),intent(in) :: self
   _DECLARE_ARGUMENTS_DO_BOTTOM_
!
! !LOCAL VARIABLES:
   real(rk) :: temp, oxy, det,sed1
   real(rk) :: rhs!
   real(rk) :: bioom6
   real(rk) :: mb1 ! macrobenthos
   real(rk) :: FM
   real(rk) :: MBonDet=0.0_rk
   real(rk) :: MBonSed=0.0_rk
   real(rk) :: MBonDom=0.0_rk 
   real(rk) :: dom 
   real(rk) :: ttemp 
   real(rk) :: rcMB,rrcMB,MBflux ! 
   real(rk) :: expterm
   real(rk),allocatable :: prey(:)!
   real(rk),allocatable :: MBonprey(:)!
   integer :: iprey


! Prey composition checks:
logical, dimension(:), allocatable :: hasNprey, hasPprey, hasSprey

! Similarly for DET composition:
logical :: hasNdet, hasPdet, hasSdet
logical :: hasNdom, hasPdom, hasSdom
logical :: hasNsed, hasPsed, hasSsed
!EOP
!-----------------------------------------------------------------------
!BOC

   allocate(prey(self%nprey))
   allocate(MBonprey(self%nprey))
   allocate(hasNprey(self%nprey))
   allocate(hasPprey(self%nprey))
   allocate(hasSprey(self%nprey))

   _HORIZONTAL_LOOP_BEGIN_

   _GET_(self%id_temp,temp)
   _GET_(self%id_oxy,oxy)
   _GET_(self%id_det,det)
   _GET_HORIZONTAL_(self%id_sed1,sed1)
    !  Get vars for MB
    do iprey=1,self%nprey
     _GET_(self%id_prey(iprey),prey(iprey))
     prey(iprey)=prey(iprey)*self%scaleprey(iprey) !convert prey conc. into E2E unit
     hasNprey(iprey) = (index(self%compositionprey(iprey), 'n') /= 0)
     hasPprey(iprey) = (index(self%compositionprey(iprey), 'p') /= 0)
     hasSprey(iprey) = (index(self%compositionprey(iprey), 's') /= 0)
    enddo
    ! DET composition checks:
    hasNdet = (index(self%compositiondet,'n') /= 0)
    hasPdet = (index(self%compositiondet,'p') /= 0)
    hasSdet = (index(self%compositiondet,'s') /= 0)
    ! DOM composition checks:
    hasNdom = (index(self%compositiondom,'n') /= 0)
    hasPdom = (index(self%compositiondom,'p') /= 0)
    hasSdom = (index(self%compositiondom,'s') /= 0)
    ! sed composition checks:
    hasNsed = (index(self%compositionsed,'n') /= 0)
    hasPsed = (index(self%compositionsed,'p') /= 0)
    hasSsed = (index(self%compositionsed,'s') /= 0)


   _GET_(self%id_dom,dom)
   _GET_HORIZONTAL_(self%id_mb1,mb1) ! 
   ! Convert det, dom and sed into E2E units
   det=det*self%scaledet
   dom=dom*self%scaledom
   sed1=sed1*self%scalesed
   bioom6 = 0.0_rk
   if (oxy > 0) then
     bioom6 = 1.0_rk
   end if
!-----------------t dependy for fish & MB  -------------------------
        ttemp=temp/((temp+273.15)*273.15)
        expterm = exp((self%tempcMB1/(8.6173324*10.**(-4.)))*ttemp) 
!---------------------------------------------------------------
! Macrobenthos feeding preferences
     FM=0.0_rk
    do iprey=1,self%nprey
     FM=FM+self%pref(iprey)*prey(iprey)!
    enddo
     FM=FM+self%prefMB1Det*det+self%prefMB1Sed*sed1+self%prefMB1Dom*dom

    do iprey=1,self%nprey
     MBonprey(iprey)=0.
    enddo

     !   MBonDet  =0.
     !   MBonSed  =0.
     !   MBonDom  =0.

       if(oxy .gt. 0.0)then  !hypoxia
       do iprey=1,self%nprey
         if(prey(iprey).ge.0.) MBonprey(iprey)=self%pref(iprey)*self%Gr(iprey)*prey(iprey)/(self%rMB1+FM)
       enddo
       if(det.ge.0.) MBonDet =self%prefMB1Det*self%GrMB1Det*det/(self%rMB1+FM)
       if(sed1.ge.0.) MBonSed =self%prefMB1Sed*self%GrMB1Sed*sed1/(self%rMB1+FM)
       if(dom.ge.0.) MBonDom =self%prefMB1Dom*self%GrMB1Det*dom/(self%rMB1+FM)
       endif

       ! Macrobenthos 
        rrcMB=MBonSed+MBonDet+MBonDom

       do iprey=1,self%nprey
        rrcMB=rrcMB + MBonprey(iprey)! 
       enddo
        rcMB=(+self%BioC21*rrcMB  &
             -self%mMB1 &
           -self%excMB1*expterm)*mb1 
         _ADD_BOTTOM_SOURCE_(self%id_mb1,rcMB)      
        MBflux=-MBonSed*mb1+(1.-self%frr)*((1.-self%BioC21)*rrcMB+self%mMB1)*mb1 !
         
        _ADD_BOTTOM_SOURCE_(self%id_sed1,MBflux/self%scalesed)      
        if (hasNsed) _ADD_BOTTOM_SOURCE_(self%id_sedn,MBflux*redf(4)/(redf(2)*redf(6)*self%scalesed))     !  
        if (hasPsed) _ADD_BOTTOM_SOURCE_(self%id_sedp,MBflux/(redf(2)*redf(6)*self%scalesed))     !  
        if (hasSsed) _ADD_BOTTOM_SOURCE_(self%id_seds,MBflux*redf(4)/(redf(2)*redf(6)*self%scalesed))     ! 
       do iprey=1,self%nprey
         _ADD_BOTTOM_FLUX_(self%id_prey(iprey),-MBonprey(iprey)*mb1/self%scaleprey(iprey))     ! 
         if (hasNprey(iprey)) _ADD_BOTTOM_FLUX_(self%id_preyn(iprey),-MBonprey(iprey)*mb1*redf(4)/(redf(2)*redf(6)*self%scaleprey(iprey)))     !  
         if (hasPprey(iprey)) _ADD_BOTTOM_FLUX_(self%id_preyp(iprey),-MBonprey(iprey)*mb1/(redf(2)*redf(6)*self%scaleprey(iprey)))     !  
         if (hasSprey(iprey)) _ADD_BOTTOM_FLUX_(self%id_preys(iprey),-MBonprey(iprey)*mb1*redf(4)/(redf(2)*redf(6)*self%scaleprey(iprey)))     !  
       enddo
         MBflux=-MBonDet*mb1  ! 
          _ADD_BOTTOM_FLUX_(self%id_det,MBflux/self%scaledet) !  
         if (hasNdet) _ADD_BOTTOM_FLUX_(self%id_detn,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  
         if (hasPdet) _ADD_BOTTOM_FLUX_(self%id_detp,MBflux/(redf(2)*redf(6)*self%scaledet))     !  
         if (hasSdet) _ADD_BOTTOM_FLUX_(self%id_dets,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledet))     !  


         MBflux=-MBonDom*mb1+(self%frr)*(((1.-self%BioC21)*rrcMB+self%mMB1)*mb1)  ! 
         _ADD_BOTTOM_FLUX_(self%id_dom,MBflux/self%scaledom)     !  
         if (hasNdom) _ADD_BOTTOM_FLUX_(self%id_domn,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledom))     !  
        if (hasPdom) _ADD_BOTTOM_FLUX_(self%id_domp,MBflux/(redf(2)*redf(6)*self%scaledom))     ! 
        if (hasSdom) _ADD_BOTTOM_FLUX_(self%id_doms,MBflux*redf(4)/(redf(2)*redf(6)*self%scaledom))     !  
        MBflux=+self%excMB1*expterm*mb1 ! 
         _ADD_BOTTOM_FLUX_(self%id_nh4,MBflux/self%scalenh4)     !  
         _ADD_BOTTOM_FLUX_(self%id_pho,MBflux/self%scalepho) ! 
        MBflux =-(BioOM6*6.625_rk*self%excMB1* & ! 
              expterm*mb1) & ! 
                *REDF(11)*REDF(16) ! 
         _ADD_BOTTOM_FLUX_(self%id_oxy,MBflux/self%scaleo2) !  

!Set diagnostic for MB 
 do iprey=1,self%nprey
   _SET_BOTTOM_DIAGNOSTIC_(self%id_dMBonprey(iprey),MBonprey(iprey))!
 enddo
_SET_BOTTOM_DIAGNOSTIC_(self%id_dMBonDet,MBonDet)!
_SET_BOTTOM_DIAGNOSTIC_(self%id_dMBonDom,MBonDom)!
_SET_BOTTOM_DIAGNOSTIC_(self%id_dMBonSed,MBonSed)!
   _HORIZONTAL_LOOP_END_
   end subroutine do_bottom
!EOC

   end module fabm_ecosmoe2e_mb


!-----------------------------------------------------------------------
! Copyright by the E2E-team under the GNU Public License - www.gnu.org
!-----------------------------------------------------------------------
